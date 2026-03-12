import "dotenv/config";
import { Telegraf } from "telegraf";
import Database from "better-sqlite3";
import OpenAI from "openai";
import { scanMarket } from "./scanner.js";

// --- CONFIGURACIÓN ---
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const db = new Database('alpha_centauri.db');

// ⚠️ PON TU ID DE TELEGRAM AQUÍ
const MY_CHAT_ID = 745415554; 

// --- PARÁMETROS DE GESTIÓN ($500) ---
const TRADE_SIZE = 50; 
const STOP_LOSS_PCT = -12;
const TAKE_PROFIT_PCT = 25;

// --- INICIALIZACIÓN DE BASE DE DATOS ---
db.prepare(`CREATE TABLE IF NOT EXISTS portfolio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT, address TEXT, entry_price REAL, exit_price REAL, 
    pnl_usd REAL, status TEXT DEFAULT 'OPEN', timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS watchlist (
    address TEXT PRIMARY KEY, token TEXT, added_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

// --- LÓGICA DE INTELIGENCIA ARTIFICIAL ---
async function analyzeWithAI(token) {
    const prompt = `Analiza este token de Solana: ${token.token} ($${token.address}).
    Mcap: $${token.mcap}, Liquidez: $${token.liquidity}, Ratio B/S: ${token.ratio.toFixed(2)}.
    RugCheck Score: ${token.rugcheckScore || 'N/A'}.
    ¿Es una buena inversión de $50 o detectas riesgos (Red Flags)?
    Responde en JSON: {"decision": "BUY"|"SKIP", "score": 0-100, "reason": "breve", "redflags": []}`;

    try {
        const res = await openai.chat.completions.create({
            messages: [{ role: "system", content: "Eres Alpha-Centauri-01, auditor de riesgos DeFAI." }, { role: "user", content: prompt }],
            model: "gpt-4-turbo-preview",
            response_format: { type: "json_object" }
        });
        return JSON.parse(res.choices[0].message.content);
    } catch (e) { return null; }
}

// --- GESTIÓN DE TRADES ---
async function closeTrade(id, exitPrice, entryPrice, tokenName, reason) {
    const profitUsd = ((exitPrice - entryPrice) / entryPrice) * TRADE_SIZE;
    db.prepare("UPDATE portfolio SET status = 'CLOSED', exit_price = ?, pnl_usd = ? WHERE id = ?")
      .run(exitPrice, profitUsd, id);
    
    const emoji = profitUsd > 0 ? "💰" : "🛑";
    await bot.telegram.sendMessage(MY_CHAT_ID, 
        `${emoji} **POSICIÓN CERRADA: ${tokenName}**\nMotivo: ${reason}\nResultado: $${profitUsd.toFixed(2)} (${((exitPrice - entryPrice)/entryPrice*100).toFixed(2)}%)`, 
        { parse_mode: 'Markdown' });
}

async function sendReport() {
    const stats = db.prepare("SELECT SUM(pnl_usd) as total, COUNT(*) as count FROM portfolio WHERE status = 'CLOSED'").get();
    const open = db.prepare("SELECT count(*) as count FROM portfolio WHERE status = 'OPEN'").get();
    const msg = `📊 **REPORTE DE RENTABILIDAD**\n\n` +
                `💵 PnL Realizado: \`$${(stats.total || 0).toFixed(2)}\`\n` +
                `🔄 Trades cerrados: ${stats.count}\n` +
                `⏳ Posiciones abiertas: ${open.count}\n` +
                `🏦 Valor Cartera: \`$${(500 + (stats.total || 0)).toFixed(2)}\``;
    await bot.telegram.sendMessage(MY_CHAT_ID, msg, { parse_mode: 'Markdown' });
}

// --- EL MOTOR (CORE LOOP) ---
async function coreLoop() {
    try {
        console.log("🔄 Escaneando mercado...");
        const tokens = await scanMarket();
        if (!tokens || tokens.length === 0) return;

        // 1. Monitorizar Posiciones (SL/TP)
        const openPositions = db.prepare("SELECT * FROM portfolio WHERE status = 'OPEN'").all();
        for (const pos of openPositions) {
            const live = tokens.find(t => t.address === pos.address);
            if (live) {
                const change = ((live.price - pos.entry_price) / pos.entry_price) * 100;
                if (change <= STOP_LOSS_PCT) await closeTrade(pos.id, live.price, pos.entry_price, pos.token, "Stop Loss");
                else if (change >= TAKE_PROFIT_PCT) await closeTrade(pos.id, live.price, pos.entry_price, pos.token, "Take Profit");
            }
        }

        // 2. Analizar Nuevas Entradas
        for (const token of tokens) {
            const alreadyIn = db.prepare("SELECT id FROM portfolio WHERE address = ? AND status = 'OPEN'").get(token.address);
            const recentlyClosed = db.prepare("SELECT id FROM portfolio WHERE address = ? AND timestamp > datetime('now', '-12 hours')").get(token.address);

            if (!alreadyIn && !recentlyClosed && token.momentum) {
                const audit = await analyzeWithAI(token);
                if (audit && audit.decision === "BUY" && audit.score > 85) {
                    db.prepare("INSERT INTO portfolio (token, address, entry_price) VALUES (?, ?, ?)").run(token.token, token.address, token.price);
                    await bot.telegram.sendMessage(MY_CHAT_ID, `🟢 **COMPRA AUTÓNOMA ($${TRADE_SIZE})**\nToken: ${token.token}\nConfianza: ${audit.score}%\nNota: ${audit.reason}`);
                }
            }
        }
    } catch (err) { console.error("Error Loop:", err.message); }
}

// --- COMANDOS ---
bot.command('status', (ctx) => {
    const open = db.prepare("SELECT * FROM portfolio WHERE status = 'OPEN'").all();
    if (open.length === 0) return ctx.reply("No hay posiciones abiertas.");
    let m = "🛒 **Posiciones:**\n";
    open.forEach(p => m += `- ${p.token}: $${p.entry_price.toFixed(6)}\n`);
    ctx.reply(m, { parse_mode: 'Markdown' });
});

bot.command('report', () => sendReport());

bot.command('panic', async (ctx) => {
    const open = db.prepare("SELECT * FROM portfolio WHERE status = 'OPEN'").all();
    for (const p of open) await closeTrade(p.id, p.entry_price * 0.98, p.entry_price, p.token, "PÁNICO");
    ctx.reply("🛑 PÁNICO: Todas las posiciones cerradas.");
});

bot.command('watch', (ctx) => {
    const addr = ctx.message.text.split(' ')[1];
    if (!addr) return ctx.reply("Uso: /watch [direccion]");
    db.prepare("INSERT OR REPLACE INTO watchlist (address, token) VALUES (?, ?)").run(addr, "Vigilado");
    ctx.reply("👀 Añadido a la lista de vigilancia.");
});

// --- INICIO ---
bot.launch({ dropPendingUpdates: true });
setInterval(coreLoop, 60000);
setInterval(() => { // Reporte diario 21:00
    const d = new Date();
    if (d.getHours() === 21 && d.getMinutes() === 0) sendReport();
}, 60000);

coreLoop();
console.log("🚀 Alpha-Centauri-01: Sistema totalmente operativo.");
