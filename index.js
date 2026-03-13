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
const STOP_LOSS_PCT = -8;
const TAKE_PROFIT_PCT = 25;

const MAX_OPEN_TRADES = 8;

// --- BASE DE DATOS ---
db.prepare(`CREATE TABLE IF NOT EXISTS portfolio (
id INTEGER PRIMARY KEY AUTOINCREMENT,
token TEXT,
address TEXT,
entry_price REAL,
exit_price REAL,
pnl_usd REAL,
status TEXT DEFAULT 'OPEN',
timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS watchlist (
address TEXT PRIMARY KEY,
token TEXT,
added_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

// --- IA ---
async function analyzeWithAI(token) {

const prompt = `Analiza este token de Solana.

Token: ${token.token}
Address: ${token.address}

MarketCap: $${token.mcap}
Liquidez: $${token.liquidity}
Ratio B/S: ${token.ratio.toFixed(2)}
Volumen 5m: ${token.v5m}

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

console.log("AI ERROR", e);
return null;

}

}

// --- CERRAR TRADE ---
async function closeTrade(id, exitPrice, entryPrice, tokenName, reason) {

const profitUsd = ((exitPrice - entryPrice) / entryPrice) * TRADE_SIZE;

db.prepare(`
UPDATE portfolio
SET status='CLOSED', exit_price=?, pnl_usd=?
WHERE id=?
`).run(exitPrice, profitUsd, id);

const emoji = profitUsd > 0 ? "💰" : "🛑";

await bot.telegram.sendMessage(
MY_CHAT_ID,
`${emoji} POSICIÓN CERRADA ${tokenName}

Motivo: ${reason}
Resultado: $${profitUsd.toFixed(2)} (${((exitPrice-entryPrice)/entryPrice*100).toFixed(2)}%)
`,
{ parse_mode: "Markdown" }
);

}

// --- REPORTE ---
async function sendReport() {

const stats = db.prepare(`
SELECT SUM(pnl_usd) as total, COUNT(*) as count
FROM portfolio
WHERE status='CLOSED'
`).get();

const open = db.prepare(`
SELECT count(*) as count
FROM portfolio
WHERE status='OPEN'
`).get();

const msg = `📊 REPORTE BOT

PnL realizado: $${(stats.total || 0).toFixed(2)}
Trades cerrados: ${stats.count}
Trades abiertos: ${open.count}

Valor cartera estimado: $${(500 + (stats.total || 0)).toFixed(2)}
`;

await bot.telegram.sendMessage(MY_CHAT_ID, msg);

}

// --- CORE LOOP ---
async function coreLoop() {

try {

console.log("Escaneando mercado...");

let tokens = await scanMarket();

if (!tokens || tokens.length === 0) return;

// limitar tokens analizados
tokens = tokens.slice(0, 25);

// --- MONITOREAR POSICIONES ---
const openPositions = db.prepare(`
SELECT *
FROM portfolio
WHERE status='OPEN'
`).all();

for (const pos of openPositions) {

const live = tokens.find(t => t.address === pos.address);

if (!live) continue;

const change = ((live.price - pos.entry_price) / pos.entry_price) * 100;

if (change <= STOP_LOSS_PCT)
await closeTrade(pos.id, live.price, pos.entry_price, pos.token, "STOP LOSS");

else if (change >= TAKE_PROFIT_PCT)
await closeTrade(pos.id, live.price, pos.entry_price, pos.token, "TAKE PROFIT");

}

// --- NUEVAS ENTRADAS ---
for (const token of tokens) {

const alreadyIn = db.prepare(`
SELECT id FROM portfolio
WHERE address=? AND status='OPEN'
`).get(token.address);

const recentlyClosed = db.prepare(`
SELECT id FROM portfolio
WHERE address=? AND timestamp > datetime('now','-12 hours')
`).get(token.address);

if (alreadyIn || recentlyClosed) continue;

// filtro básico antes de IA
if (
token.liquidity < 25000 ||
token.v5m < 5000 ||
token.ratio < 1.2
) {
console.log(`Filtro descartó ${token.token}`);
continue;
}

// limitar trades
const openCount = db.prepare(`
SELECT count(*) as count
FROM portfolio
WHERE status='OPEN'
`).get();

if (openCount.count >= MAX_OPEN_TRADES) continue;

const audit = await analyzeWithAI(token);

if (!audit) continue;

console.log(`IA analizó ${token.token} score ${audit.score}`);

if (audit.decision === "BUY" && audit.score > 85) {

db.prepare(`
INSERT INTO portfolio(token,address,entry_price)
VALUES(?,?,?)
`).run(token.token, token.address, token.price);

await bot.telegram.sendMessage(
MY_CHAT_ID,
`🟢 COMPRA AUTÓNOMA ($${TRADE_SIZE})

Token: ${token.token}
Confianza IA: ${audit.score}%

${audit.reason}
`
);

}

}

} catch (err) {

console.error("Loop error:", err.message);

}

}

// --- COMANDOS ---
bot.command("status", (ctx) => {

if (ctx.chat.id !== MY_CHAT_ID) return;

const open = db.prepare(`
SELECT *
FROM portfolio
WHERE status='OPEN'
`).all();

if (!open.length) return ctx.reply("No hay posiciones abiertas.");

let msg = "POSICIONES ABIERTAS\n\n";

open.forEach(p => {
msg += `${p.token} entrada $${p.entry_price}\n`;
});

ctx.reply(msg);

});

bot.command("report", (ctx) => {

if (ctx.chat.id !== MY_CHAT_ID) return;

sendReport();

});

bot.command("panic", async (ctx) => {

if (ctx.chat.id !== MY_CHAT_ID) return;

const open = db.prepare(`
SELECT *
FROM portfolio
WHERE status='OPEN'
`).all();

for (const p of open) {

await closeTrade(
p.id,
p.entry_price * 0.98,
p.entry_price,
p.token,
"PANIC"
);

}

ctx.reply("Todas las posiciones cerradas.");

});

bot.command("watch", (ctx) => {

if (ctx.chat.id !== MY_CHAT_ID) return;

const addr = ctx.message.text.split(" ")[1];

if (!addr) return ctx.reply("Uso: /watch direccion");

db.prepare(`
INSERT OR REPLACE INTO watchlist(address,token)
VALUES(?,?)
`).run(addr, "WATCH");

ctx.reply("Token añadido a vigilancia.");

});

// --- GESTIÓN DE INICIO Y CONEXIÓN (Anti-Error 409) ---
const startBot = async () => {
    try {
        // Intentamos conectar
        await bot.launch({ dropPendingUpdates: true });
        console.log("🚀 Alpha-Centauri-01: Conectado a Telegram con éxito.");
    } catch (err) {
        // Si hay conflicto (Error 409), esperamos 5 segundos y reintentamos
        if (err.response && err.response.error_code === 409) {
            console.log("⚠️ Conflicto de conexión (409). Reintentando en 5 segundos...");
            setTimeout(startBot, 5000);
        } else {
            console.error("❌ Error inesperado al lanzar el bot:", err.message);
        }
    }
};

// 1. Iniciamos el bot con el sistema de reintento
startBot();

// 2. Iniciamos el bucle de escaneo cada 60 segundos
setInterval(coreLoop, 60000);

// 3. Iniciamos el bucle del reporte diario (a las 21:00)
setInterval(() => {
    const d = new Date();
    if (d.getHours() === 21 && d.getMinutes() === 0) {
        sendReport();
    }
}, 60000);

// 4. Ejecutamos el primer escaneo de inmediato al arrancar
coreLoop();

console.log("🤖 Alpha-Centauri iniciado y patrullando el mercado...");
