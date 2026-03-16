console.log("🎬 Iniciando motor Alpha-Centauri...");
console.log("📅 Hora actual:", new Date().toLocaleString());

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

// --- INICIALIZACIÓN DE BASE DE DATOS ---
db.prepare(`CREATE TABLE IF NOT EXISTS portfolio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT, address TEXT, entry_price REAL, 
    highest_price REAL, 
    exit_price REAL, 
    pnl_usd REAL, status TEXT DEFAULT 'OPEN', timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

// Verificar si la columna highest_price existe, si no, crearla
const tableInfo = db.prepare("PRAGMA table_info(portfolio)").all();
if (!tableInfo.some(col => col.name === 'highest_price')) {
    db.prepare("ALTER TABLE portfolio ADD COLUMN highest_price REAL").run();
}

// --- IA (PROMPT DE ACUMULACIÓN + IA AGENTS) ---
async function analyzeWithAI(token) {
    const prompt = `Analiza este token de Solana para una posible inversión.
Trigger: ${token.trigger}
Token: ${token.token} | MCap: $${token.mcap} | Liq: $${token.liquidity}
Volumen 5m: $${token.v5m} | Ratio B/S: ${token.ratio ? token.ratio.toFixed(2) : "1"}
RugCheck Score: ${token.rugcheckScore}

INSTRUCCIONES CRÍTICAS:
1. Si el volumen es alto ($> 2000$) pero el precio está lateral, evalúa si es una fase de ACUMULACIÓN.
2. Si es 🤖 AI AGENT, sé más flexible con la volatilidad inicial si la narrativa es coherente.
3. Penaliza severamente (Score < 30) si la liquidez está bajando en cada ciclo.

Responde estrictamente en JSON:
{
"decision":"BUY|SKIP",
"score":0-100,
"reason":"explicación técnica breve",
"isAccumulation": true/false
}`;

    try {
        const res = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "Eres un analista de Smart Money en Solana, experto en detectar acumulación de ballenas y narrativas de IA." },
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
    try {
        const stats = db.prepare(`SELECT SUM(pnl_usd) as total, COUNT(*) as count FROM portfolio WHERE status='CLOSED'`).get();
        const open = db.prepare(`SELECT count(*) as count FROM portfolio WHERE status='OPEN'`).get();
        
        const msg = `📊 **REPORTE ALPHA-CENTAURI**\n\n` +
                    `💵 PnL Realizado: \`$${(stats.total || 0).toFixed(2)}\`\n` +
                    `🔄 Trades cerrados: ${stats.count}\n` +
                    `⏳ Trades abiertos: ${open.count}/${MAX_OPEN_TRADES}\n\n` +
                    `🏦 Valor Cartera Estimado: \`$${(500 + (stats.total || 0)).toFixed(2)}\``;

        await bot.telegram.sendMessage(MY_CHAT_ID, msg, { parse_mode: 'Markdown' });
    } catch (e) { console.error("Error Report:", e.message); }
}

// --- EL MOTOR (CORE LOOP) ---
async function coreLoop() {
    const timestamp = new Date().toLocaleTimeString();
    try {
        console.log(`\n[${timestamp}] 🔄 Escaneando mercado...`);
        const tokens = await scanMarket();
        
        if (!tokens || tokens.length === 0) {
            console.log(`[${timestamp}] ℹ️ Sin candidatos que pasen los filtros de Scanner.`);
            return;
        }

        const openPositions = db.prepare("SELECT * FROM portfolio WHERE status = 'OPEN'").all();

        // 1. MONITORIZACIÓN DINÁMICA DE TRADES ABIERTOS
        for (const pos of openPositions) {
            const live = tokens.find(t => t.address === pos.address);
            if (live) {
                const currentPrice = live.price;
                let highest = Math.max(pos.highest_price || 0, currentPrice);

                if (highest > (pos.highest_price || 0)) {
                    db.prepare("UPDATE portfolio SET highest_price = ? WHERE id = ?").run(highest, pos.id);
                }

                const totalProfit = ((currentPrice - pos.entry_price) / pos.entry_price) * 100;
                const dropFromPeak = ((currentPrice - highest) / highest) * 100;

                if (totalProfit > 2 && dropFromPeak <= TRAILING_STOP_DIST) {
                    await closeTrade(pos.id, currentPrice, pos.entry_price, pos.token, `Trailing Stop (${dropFromPeak.toFixed(1)}%)`);
                } else if (totalProfit <= STOP_LOSS_INITIAL) {
                    await closeTrade(pos.id, currentPrice, pos.entry_price, pos.token, "Stop Loss Inicial");
                }
            }
        }

        // 2. ANALIZAR NUEVAS ENTRADAS
        if (openPositions.length < MAX_OPEN_TRADES) {
            for (const token of tokens) {
                const alreadyIn = db.prepare("SELECT id FROM portfolio WHERE address = ? AND status = 'OPEN'").get(token.address);
                const recentlyClosed = db.prepare("SELECT id FROM portfolio WHERE address = ? AND status = 'CLOSED' AND timestamp > datetime('now', '-4 hours')").get(token.address);

                if (!alreadyIn && !recentlyClosed) {
                    console.log(`🧠 [${token.token}] Analizando con IA...`);
                    const audit = await analyzeWithAI(token);
                    
                    if (audit && audit.decision === "BUY" && audit.score > 60) {
                        console.log(`✅ COMPRA: ${token.token} (Score: ${audit.score})`);
                        db.prepare("INSERT INTO portfolio (token, address, entry_price, highest_price) VALUES (?, ?, ?, ?)")
                          .run(token.token, token.address, token.price, token.price);
                        
                        await bot.telegram.sendMessage(MY_CHAT_ID, 
                            `🟢 **COMPRA AUTÓNOMA ($${TRADE_SIZE})**\n` +
                            `Token: ${token.token}\n` +
                            `Confianza: ${audit.score}%\n` +
                            `Nota: ${audit.reason}`, 
                            { parse_mode: 'Markdown' });
                        break; 
                    } else if (audit) {
                        console.log(`📊 [${token.token}] Veredicto IA: SKIP (Score: ${audit.score})`);
                    }
                }
            }
        }
        console.log(`[${timestamp}] ✅ Patrulla completada.`);
    } catch (err) { 
        console.error(`[${timestamp}] ❌ Error en Loop:`, err.message); 
    }
}

// --- COMANDOS TELEGRAM ---
bot.command('status', (ctx) => {
    const open = db.prepare("SELECT * FROM portfolio WHERE status = 'OPEN'").all();
    if (open.length === 0) return ctx.reply("🛒 Cartera vacía.");
    
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

// --- INICIO DEL SISTEMA ---
const startBot = async () => {
    try {
        await bot.launch({ dropPendingUpdates: true });
        console.log("🚀 Alpha-Centauri-01: Sistema Online y Patrullando.");
        
        // Ejecución inmediata del primer ciclo
        coreLoop();
        
        // Intervalo de escaneo cada 2 minutos
        setInterval(coreLoop, 120000);

        // Reporte automático diario a las 21:00
        setInterval(() => {
            const d = new Date();
            if (d.getHours() === 21 && d.getMinutes() === 0) sendReport();
        }, 60000);

    } catch (err) {
        console.error("⚠️ Error inicio:", err.message);
        setTimeout(startBot, 5000);
    }
};

startBot();
