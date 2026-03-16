import "dotenv/config";
import { Telegraf } from "telegraf";
import Database from "better-sqlite3";
import OpenAI from "openai";
import { scanMarket } from "./scanner.js";

// --- CONFIGURACIÓN ---
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const db = new Database("alpha_centauri.db");

const MY_CHAT_ID = 745415554;

// --- PARÁMETROS BOT ---
const TRADE_SIZE = 50; 
const STOP_LOSS_INITIAL = -12; 
const TRAILING_STOP_DIST = -10; 
const MAX_OPEN_TRADES = 8; 

// Memoria temporal para no repetir logs de la IA cada 2 minutos sobre el mismo token
let aiLogHistory = new Set();

// --- INICIALIZACIÓN DE BASE DE DATOS ---
db.prepare(`CREATE TABLE IF NOT EXISTS portfolio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT, address TEXT, entry_price REAL, 
    highest_price REAL, 
    exit_price REAL, 
    pnl_usd REAL, status TEXT DEFAULT 'OPEN', timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

try {
    db.prepare("ALTER TABLE portfolio ADD COLUMN highest_price REAL").run();
} catch (e) { /* Ya existe */ }

db.prepare(`CREATE TABLE IF NOT EXISTS watchlist (
    address TEXT PRIMARY KEY, token TEXT, added_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

// --- IA ---
async function analyzeWithAI(token) {
    const prompt = `Analiza este token de Solana.
Token: ${token.token}
Address: ${token.address}
MarketCap: $${token.mcap}
Liquidez: $${token.liquidity}
Ratio B/S: ${token.ratio ? token.ratio.toFixed(2) : "N/A"}
Volumen 5m: $${token.v5m}
RugCheck Score: ${token.rugcheckScore || "N/A"}

Responde JSON:
{
"decision":"BUY|SKIP",
"score":0-100,
"reason":"breve",
"redflags":[]
}`;

    try {
        await new Promise(r => setTimeout(r, 400));
        const res = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "Eres un auditor experto en riesgos de tokens en Solana." },
                { role: "user", content: prompt }
            ],
            response_format: { type: "json_object" }
        });
        return JSON.parse(res.choices[0].message.content);
    } catch (e) {
        console.log("❌ AI ERROR:", e.message);
        return null;
    }
}

// --- GESTIÓN DE TRADES ---
async function closeTrade(id, exitPrice, entryPrice, tokenName, reason) {
    const profitUsd = ((exitPrice - entryPrice) / entryPrice) * TRADE_SIZE;
    db.prepare("UPDATE portfolio SET status = 'CLOSED', exit_price = ?, pnl_usd = ? WHERE id = ?")
      .run(exitPrice, profitUsd, id);
    
    const emoji = profitUsd > 0 ? "💰" : "🛑";
    await bot.telegram.sendMessage(MY_CHAT_ID, 
        `${emoji} **POSICIÓN CERRADA: ${tokenName}**\n` +
        `Motivo: ${reason}\n` +
        `Resultado: $${profitUsd.toFixed(2)} (${((exitPrice - entryPrice)/entryPrice*100).toFixed(2)}%)`, 
        { parse_mode: 'Markdown' });
}

async function sendReport() {
    const stats = db.prepare(`SELECT SUM(pnl_usd) as total, COUNT(*) as count FROM portfolio WHERE status='CLOSED'`).get();
    const open = db.prepare(`SELECT count(*) as count FROM portfolio WHERE status='OPEN'`).get();
    
    const msg = `📊 **REPORTE ALPHA-CENTAURI**\n\n` +
                `💵 PnL Realizado: \`$${(stats.total || 0).toFixed(2)}\`\n` +
                `🔄 Trades cerrados: ${stats.count}\n` +
                `⏳ Trades abiertos: ${open.count}/${MAX_OPEN_TRADES}\n\n` +
                `🏦 Valor Cartera: \`$${(500 + (stats.total || 0)).toFixed(2)}\``;

    await bot.telegram.sendMessage(MY_CHAT_ID, msg, { parse_mode: 'Markdown' });
}

// --- EL MOTOR (CORE LOOP) ---
async function coreLoop() {
    try {
        console.log("🔄 Escaneando mercado...");
        const tokens = await scanMarket();
        if (!tokens || tokens.length === 0) return;

        const openPositions = db.prepare("SELECT * FROM portfolio WHERE status = 'OPEN'").all();

        // 1. MONITORIZACIÓN DINÁMICA
        for (const pos of openPositions) {
            const live = tokens.find(t => t.address === pos.address);
            if (live) {
                const currentPrice = live.price;
                let highest = pos.highest_price || pos.entry_price;

                if (currentPrice > highest) {
                    highest = currentPrice;
                    db.prepare("UPDATE portfolio SET highest_price = ? WHERE id = ?").run(highest, pos.id);
                }

                const totalProfit = ((currentPrice - pos.entry_price) / pos.entry_price) * 100;
                const dropFromPeak = ((currentPrice - highest) / highest) * 100;

                let shouldSell = false;
                let reason = "";

                if (totalProfit > 2 && dropFromPeak <= TRAILING_STOP_DIST) {
                    shouldSell = true;
                    reason = `Trailing Stop (${dropFromPeak.toFixed(1)}%)`;
                } else if (totalProfit <= STOP_LOSS_INITIAL) {
                    shouldSell = true;
                    reason = `Stop Loss Inicial (${STOP_LOSS_INITIAL}%)`;
                }

                if (shouldSell) await closeTrade(pos.id, currentPrice, pos.entry_price, pos.token, reason);
            }
        }

        // 2. ANALIZAR NUEVAS ENTRADAS
        if (openPositions.length < MAX_OPEN_TRADES) {
            for (const token of tokens) {
                const alreadyIn = db.prepare("SELECT id FROM portfolio WHERE address = ? AND status = 'OPEN'").get(token.address);
                const recentlyClosed = db.prepare("SELECT id FROM portfolio WHERE address = ? AND timestamp > datetime('now', '-12 hours')").get(token.address);

                if (!alreadyIn && !recentlyClosed && token.momentum) {
                    
                    // Solo logueamos el análisis una vez por token para no saturar la consola
                    if (!aiLogHistory.has(token.address)) {
                        console.log(`🧠 IA analizando: ${token.token}...`);
                    }

                    const audit = await analyzeWithAI(token);
                    
                    if (audit) {
                        // Log del resultado de la IA en consola
                        if (!aiLogHistory.has(token.address)) {
                            console.log(`📊 Resultado IA para ${token.token}: [${audit.decision}] Score: ${audit.score}/100`);
                            aiLogHistory.add(token.address);
                            // Limpiamos memoria si crece mucho
                            if (aiLogHistory.size > 50) aiLogHistory.clear();
                        }

                        // UMBRAL DE TEST: Bajamos a 70 para ver acción
                        if (audit.decision === "BUY" && audit.score >= 60) {
                            db.prepare("INSERT INTO portfolio (token, address, entry_price, highest_price) VALUES (?, ?, ?, ?)")
                              .run(token.token, token.address, token.price, token.price);
                            
                            await bot.telegram.sendMessage(MY_CHAT_ID, 
                                `🟢 **COMPRA EJECUTADA (Test Mode)**\n` +
                                `Token: ${token.token}\n` +
                                `Confianza: ${audit.score}%\n` +
                                `Razón: ${audit.reason}`, { parse_mode: 'Markdown' });
                            
                            break; 
                        }
                    }
                }
            }
        }
    } catch (err) { console.error("Error Loop:", err.message); }
}

// --- COMANDOS ---
bot.command('status', (ctx) => {
    const open = db.prepare("SELECT * FROM portfolio WHERE status = 'OPEN'").all();
    if (open.length === 0) return ctx.reply("No hay posiciones abiertas.");
    
    let m = "🛒 **Cartera Activa:**\n\n";
    open.forEach(p => {
        const highest = p.highest_price || p.entry_price;
        const currentSL = highest * (1 + (TRAILING_STOP_DIST/100));
        m += `• **${p.token}**\n  Entrada: $${p.entry_price.toFixed(6)}\n  Máx: $${highest.toFixed(6)}\n  SL: $${currentSL.toFixed(6)}\n\n`;
    });
    ctx.reply(m, { parse_mode: 'Markdown' });
});

bot.command('report', () => sendReport());

bot.command('panic', async (ctx) => {
    const open = db.prepare("SELECT * FROM portfolio WHERE status = 'OPEN'").all();
    for (const p of open) await closeTrade(p.id, p.entry_price * 0.90, p.entry_price, p.token, "PÁNICO");
    ctx.reply("🛑 PÁNICO: Todas las posiciones cerradas.");
});

// --- INICIO ---
const startBot = async () => {
    try {
        await bot.launch({ dropPendingUpdates: true });
        console.log("🚀 Alpha-Centauri-01: Conectado.");
    } catch (err) {
        if (err.response && err.response.error_code === 409) {
            console.log("⚠️ Conflicto 409. Reintentando...");
            setTimeout(startBot, 5000);
        }
    }
};

startBot();
setInterval(coreLoop, 120000);
setInterval(() => {
    const d = new Date();
    if (d.getHours() === 21 && d.getMinutes() === 0) sendReport();
}, 60000);

coreLoop();
console.log("🤖 Alpha-Centauri patrullando con sensibilidad de IA ajustada (70%)...");
