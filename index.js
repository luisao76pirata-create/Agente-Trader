import "dotenv/config";
import { Telegraf } from "telegraf";
import Database from "better-sqlite3";
import OpenAI from "openai";
import { scanMarket } from "./scanner.js";

// --- CONFIGURACIÓN INICIAL ---
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const db = new Database('alpha_centauri.db');

// ⚠️ SUSTITUYE POR TU ID REAL DE TELEGRAM (EJ: 12345678)
const MY_CHAT_ID = 745415554; 

// --- GESTIÓN DE RIESGO ($500) ---
const TRADE_SIZE = 50; 
const STOP_LOSS_PCT = -12;
const TAKE_PROFIT_PCT = 25;

// --- BASE DE DATOS (Memoria Permanente) ---
db.prepare(`CREATE TABLE IF NOT EXISTS portfolio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT, address TEXT, entry_price REAL, exit_price REAL, 
    pnl_usd REAL, status TEXT DEFAULT 'OPEN', timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS watchlist (
    address TEXT PRIMARY KEY, token TEXT, added_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

// --- FUNCIÓN: AUDITORÍA DE IA Y SEGURIDAD ---
async function analyzeWithAI(token) {
    const prompt = `Analiza este token de Solana: ${token.token} ($${token.address}).
    Mcap: $${token.mcap}, Liquidez: $${token.liquidity}, Ratio B/S: ${token.ratio.toFixed(2)}.
    Momentum: ${token.momentum ? 'ALTO' : 'NORMAL'}.
    ¿Es una buena oportunidad de inversión de $50 o hay Red Flags?
    Responde en JSON: {"decision": "BUY"|"SKIP"|"ALERT", "score": 0-100, "reason": "breve", "redflags": []}`;

    try {
        const res = await openai.chat.completions.create({
            messages: [{ role: "system", content: "Eres Alpha-Centauri-01, un auditor DeFAI experto en Solana." }, { role: "user", content: prompt }],
            model: "gpt-4-turbo-preview",
            response_format: { type: "json_object" }
        });
        return JSON.parse(res.choices[0].message.content);
    } catch (e) { return null; }
}

// --- FUNCIÓN: CERRAR TRADES (PnL) ---
async function closeTrade(id, exitPrice, entryPrice, tokenName, reason) {
    const profitUsd = ((exitPrice - entryPrice) / entryPrice) * TRADE_SIZE;
    db.prepare("UPDATE portfolio SET status = 'CLOSED', exit_price = ?, pnl_usd = ? WHERE id = ?")
      .run(exitPrice, profitUsd, id);
    
    const emoji = profitUsd > 0 ? "💰" : "🛑";
    await bot.telegram.sendMessage(MY_CHAT_ID, 
        `${emoji} **POSICIÓN CERRADA: ${tokenName}**\n` +
        `Motivo: ${reason}\n` +
        `Resultado: ${profitUsd.toFixed(2)} USD (${((exitPrice - entryPrice)/entryPrice*100).toFixed(2)}%)`, 
        { parse_mode: 'Markdown' });
}

// --- FUNCIÓN: REPORTE DE RENTABILIDAD ---
async function sendReport() {
    const stats = db.prepare("SELECT SUM(pnl_usd) as total, COUNT(*) as count FROM portfolio WHERE status = 'CLOSED'").get();
    const open = db.prepare("SELECT COUNT(*) as count FROM portfolio WHERE status = 'OPEN'").get();
    
    let msg = `📊 **ESTADO DE RENTABILIDAD**\n\n`;
    msg += `💵 PnL Realizado: \`${(stats.total || 0).toFixed(2)} USD\`\n`;
    msg += `🔄 Trades cerrados: ${stats.count}\n`;
    msg += `⏳ Posiciones abiertas: ${open.count}\n`;
    msg += `🏦 Valor estimado cartera: \`$${(500 + (stats.total || 0)).toFixed(2)}\``;
    
    await bot.telegram.sendMessage(MY_CHAT_ID, msg, { parse_mode: 'Markdown' });
}

// --- EL MOTOR PRINCIPAL (CORE LOOP) ---
async function coreLoop() {
    console.log("🔄 Alpha-Centauri-01: Escaneando y gestionando...");
    const tokens = await scanMarket();

    // 1. MONITOREAR STOP LOSS Y TAKE PROFIT
    const openPositions = db.prepare("SELECT * FROM portfolio WHERE status = 'OPEN'").all();
    for (const pos of openPositions) {
        const live = tokens.find(t => t.address === pos.address);
        if (live) {
            const change = ((live.price - pos.entry_price) / pos.entry_price) * 100;
            if (change <= STOP_LOSS_PCT) await closeTrade(pos.id, live.price, pos.entry_price, pos.token, "Stop Loss");
            else if (change >= TAKE_PROFIT_PCT) await closeTrade(pos.id, live.price, pos.entry_price, pos.token, "Take Profit");
        }
    }

    // 2. VIGILAR WATCHLIST
    const watched = db.prepare("SELECT * FROM watchlist").all();
    for (const item of watched) {
        const live = tokens.find(t => t.address === item.address);
        if (live && live.momentum) {
            bot.telegram.sendMessage(MY_CHAT_ID, `⚠️ **MOVIMIENTO EN WATCHLIST:** ${live.token}\nVolumen 5m: $${live.v5m}\nRatio B/S: ${live.ratio.toFixed(2)}`);
        }
    }

    // 3. BUSCAR NUEVAS ENTRADAS
    for (const token of tokens) {
        const alreadyIn = db.prepare("SELECT id FROM portfolio WHERE address = ? AND status = 'OPEN'").get(token.address);
        // Memoria: No repetir el mismo token en 24h si ya se cerró
        const recentlyClosed = db.prepare("SELECT id FROM portfolio WHERE address = ? AND timestamp > datetime('now', '-24 hours')").get(token.address);

        if (!alreadyIn && !recentlyClosed && token.momentum && token.ratio > 2) {
            const audit = await analyzeWithAI(token);
            if (audit && audit.decision === "BUY" && audit.score > 85) {
                db.prepare("INSERT INTO portfolio (token, address, entry_price) VALUES (?, ?, ?)").run(token.token, token.address, token.price);
                await bot.telegram.sendMessage(MY_CHAT_ID, `🟢 **INVERSIÓN AUTÓNOMA ($${TRADE_SIZE})**\nToken: ${token.token}\nScore IA: ${audit.score}/100\nRazon: ${audit.reason}`);
            }
        }
    }
}

// --- COMANDOS TELEGRAM ---
bot.start((ctx) => ctx.reply("Alpha-Centauri-01 Activo. Comandos: /status, /report, /watch [dir], /panic"));

bot.command('status', (ctx) => {
    const open = db.prepare("SELECT * FROM portfolio WHERE status = 'OPEN'").all();
    if (open.length === 0) return ctx.reply("No hay posiciones abiertas.");
    let m = "🛒 **Posiciones Actuales:**\n";
    open.forEach(p => m += `- ${p.token}: Entrada en $${p.entry_price.toFixed(6)}\n`);
    ctx.reply(m, { parse_mode: 'Markdown' });
});

bot.command('report', () => sendReport());

bot.command('watch', (ctx) => {
    const addr = ctx.message.text.split(' ')[1];
    if (!addr) return ctx.reply("Uso: /watch [direccion]");
    db.prepare("INSERT OR REPLACE INTO watchlist (address, token) VALUES (?, ?)").run(addr, "Vigilado");
    ctx.reply("👀 Añadido a vigilancia.");
});

bot.command('panic', async (ctx) => {
    const open = db.prepare("SELECT * FROM portfolio WHERE status = 'OPEN'").all();
    for (const p of open) await closeTrade(p.id, p.entry_price * 0.99, p.entry_price, p.token, "PÁNICO MANUAL");
    ctx.reply("🛑 PÁNICO EJECUTADO. Todo cerrado.");
});

// --- INICIO ---
bot.launch();
setInterval(coreLoop, 60000); // Cada minuto
setInterval(() => { // Reporte automático a las 21:00
    const d = new Date();
    if (d.getHours() === 21 && d.getMinutes() === 0) sendReport();
}, 60000);

coreLoop();
console.log("🚀 Alpha-Centauri-01: Motor encendido y listo.");
