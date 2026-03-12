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

// --- RISK MANAGEMENT ---
const START_BALANCE = 500;
const TRADE_SIZE = 50;

const STOP_LOSS_PCT = -8;
const TAKE_PROFIT_PCT = 30;

const MAX_OPEN_TRADES = 8;
const TRADE_COOLDOWN = 10 * 60 * 1000;

let lastTradeTime = 0;

// --- DATABASE ---
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


// --- RUG CHECK ---
function rugCheck(token) {

    if (token.mintAuthority === true) return false;
    if (token.freezeAuthority === true) return false;
    if (token.lpLocked === false) return false;

    if (token.liquidity < 25000) return false;
    if (token.top10 > 40) return false;

    return true;
}


// --- SIGNAL SCORE ---
function calculateSignalScore(token) {

    let score = 0;

    if (token.momentum) score += 20;

    if (token.ratio > 2) score += 20;

    if (token.v5m > 10000) score += 20;

    if (token.liquidity > 40000) score += 20;

    if (token.uniqueBuyers5m > 20) score += 20;

    return score;
}


// --- IA AUDIT ---
async function analyzeWithAI(token) {

    const prompt = `
Analiza este token de Solana.

Token: ${token.token}
Address: ${token.address}

MarketCap: $${token.mcap}
Liquidez: $${token.liquidity}
Ratio Buy/Sell: ${token.ratio.toFixed(2)}
Volumen 5m: ${token.v5m}

Responde JSON:
{
"decision":"BUY|SKIP|ALERT",
"score":0-100,
"reason":"breve",
"redflags":[]
}
`;

    try {

        await new Promise(r => setTimeout(r, 400));

        const res = await openai.chat.completions.create({

            model: "gpt-4o-mini",

            messages: [
                {
                    role: "system",
                    content: "Eres un auditor experto en trading de tokens en Solana."
                },
                {
                    role: "user",
                    content: prompt
                }
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
Resultado: ${profitUsd.toFixed(2)} USD
`,
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
    SELECT COUNT(*) as count
    FROM portfolio
    WHERE status='OPEN'
    `).get();

    const pnl = stats.total || 0;

    const msg = `
📊 ESTADO BOT

PnL realizado: ${pnl.toFixed(2)} USD
Trades cerrados: ${stats.count}
Trades abiertos: ${open.count}

Valor estimado: ${(START_BALANCE + pnl).toFixed(2)} USD
`;

    await bot.telegram.sendMessage(MY_CHAT_ID, msg);
}


// --- CORE LOOP ---
async function coreLoop() {

    console.log("Escaneando mercado...");

    const tokens = await scanMarket();

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


    // --- BUSCAR NUEVAS ENTRADAS ---
    for (const token of tokens) {

        const alreadyIn = db.prepare(`
        SELECT id FROM portfolio
        WHERE address=? AND status='OPEN'
        `).get(token.address);

        const recentlyClosed = db.prepare(`
        SELECT id FROM portfolio
        WHERE address=? AND timestamp > datetime('now','-24 hours')
        `).get(token.address);

        if (alreadyIn || recentlyClosed) continue;

        if (!rugCheck(token)) continue;

        const signalScore = calculateSignalScore(token);

        if (signalScore < 60) continue;

        const openCount = db.prepare(`
        SELECT COUNT(*) as count
        FROM portfolio
        WHERE status='OPEN'
        `).get();

        if (openCount.count >= MAX_OPEN_TRADES) continue;

        if (Date.now() - lastTradeTime < TRADE_COOLDOWN) continue;

        const audit = await analyzeWithAI(token);

        if (audit && audit.decision === "BUY" && audit.score > 85) {

            db.prepare(`
            INSERT INTO portfolio(token,address,entry_price)
            VALUES(?,?,?)
            `).run(token.token, token.address, token.price);

            lastTradeTime = Date.now();

            await bot.telegram.sendMessage(
                MY_CHAT_ID,
                `🟢 NUEVO TRADE

Token: ${token.token}
Signal score: ${signalScore}
AI score: ${audit.score}

${audit.reason}
`
            );
        }
    }
}


// --- TELEGRAM COMMANDS ---

bot.start((ctx) => {

    if (ctx.chat.id !== MY_CHAT_ID) return;

    ctx.reply("Alpha-Centauri activo.");
});

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
        msg += `${p.token} entrada ${p.entry_price}\n`;
    });

    ctx.reply(msg);
});

bot.command("report", async (ctx) => {

    if (ctx.chat.id !== MY_CHAT_ID) return;

    await sendReport();
});

bot.command("watch", (ctx) => {

    if (ctx.chat.id !== MY_CHAT_ID) return;

    const addr = ctx.message.text.split(" ")[1];

    if (!addr) return ctx.reply("Uso: /watch direccion");

    db.prepare(`
    INSERT OR REPLACE INTO watchlist(address,token)
    VALUES(?,?)
    `).run(addr, "WATCH");

    ctx.reply("Token añadido.");
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
            p.entry_price * 0.99,
            p.entry_price,
            p.token,
            "PANIC"
        );
    }

    ctx.reply("Todo cerrado.");
});


// --- START ---
bot.launch();

setInterval(coreLoop, 60000);

setInterval(() => {

    const d = new Date();

    if (d.getHours() === 21 && d.getMinutes() === 0)
        sendReport();

}, 60000);

coreLoop();

console.log("Alpha-Centauri iniciado.");
