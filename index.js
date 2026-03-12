import "dotenv/config";
import { Telegraf } from "telegraf";
import Database from "better-sqlite3";
import OpenAI from "openai";
import { scanMarket } from "./scanner.js";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const db = new Database('alpha_centauri.db');
const MY_CHAT_ID = 745415554;

// --- ESTRUCTURA DE MEMORIA ---
db.prepare(`CREATE TABLE IF NOT EXISTS portfolio (id INTEGER PRIMARY KEY, token TEXT, address TEXT, entry_price REAL, status TEXT DEFAULT 'OPEN', timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`).run();
db.prepare(`CREATE TABLE IF NOT EXISTS watchlist (address TEXT PRIMARY KEY, token TEXT)`).run();

// --- IA CON DETECTOR DE RED FLAGS ---
async function analyzeWithRedFlags(token) {
    const prompt = `Actúa como auditor de seguridad en Solana. 
    DATOS: Token ${token.token}, Mcap $${token.mcap}, Liquidez $${token.liquidity}, Ratio B/S: ${token.ratio.toFixed(2)}.
    AUDITORÍA:
    1. Si la liquidez es < $10k, MARCA RED FLAG.
    2. Si el ratio B/S es < 1.2, MARCA RED FLAG.
    3. Si el Mcap es sospechosamente bajo vs volumen, MARCA RED FLAG.
    
    ¿Invertimos $50 o es peligroso? 
    Responde JSON: {"decision": "BUY"|"SKIP"|"ALERT", "score": 0-100, "redflags": ["razon1", "razon2"], "reason": "explicacion"}`;

    try {
        const res = await openai.chat.completions.create({
            messages: [{ role: "system", content: "Analista de riesgos DeFAI." }, { role: "user", content: prompt }],
            model: "gpt-4-turbo-preview",
            response_format: { type: "json_object" }
        });
        return JSON.parse(res.choices[0].message.content);
    } catch (e) { return null; }
}

// --- COMANDOS DE CONTROL ---
bot.command('watch', async (ctx) => {
    const address = ctx.message.text.split(' ')[1];
    if (!address) return ctx.reply("❌ Uso: /watch [direccion_del_contrato]");
    
    db.prepare("INSERT OR REPLACE INTO watchlist (address, token) VALUES (?, ?)").run(address, "Vigilado");
    ctx.reply(`👀 Entendido. He puesto a ${address} en vigilancia 24/7.`);
});

bot.command('list', (ctx) => {
    const list = db.prepare("SELECT address FROM watchlist").all();
    if (list.length === 0) return ctx.reply("Tu lista de vigilancia está vacía.");
    const msg = list.map(i => `• \`${i.address}\``).join('\n');
    ctx.reply(`📋 **Tokens en Vigilancia:**\n${msg}`, { parse_mode: 'Markdown' });
});

bot.command('status', (ctx) => {
    const open = db.prepare("SELECT * FROM portfolio WHERE status = 'OPEN'").all();
    let res = `📊 **Alpha-Centauri-01 Status**\n\n`;
    res += `💰 Presupuesto: $500\n`;
    res += `🛒 Trades abiertos: ${open.length}\n`;
    open.forEach(t => res += `- ${t.token}: Entrada en $${t.entry_price}\n`);
    ctx.reply(res, { parse_mode: 'Markdown' });
});

// --- EL MOTOR ---
async function coreLoop() {
    const tokens = await scanMarket();

    // 1. Vigilancia de Watchlist
    const watched = db.prepare("SELECT * FROM watchlist").all();
    for (const item of watched) {
        const live = tokens.find(t => t.address === item.address);
        if (live && live.momentum) {
            bot.telegram.sendMessage(MY_CHAT_ID, `⚠️ **ALERTA MOVIMIENTO:** ${live.token} está teniendo volumen inusual. Ratio B/S: ${live.ratio.toFixed(2)}`);
        }
    }

    // 2. Trader Autónomo
    for (const token of tokens) {
        const alreadyIn = db.prepare("SELECT id FROM portfolio WHERE address = ? AND status = 'OPEN'").get(token.address);
        if (!alreadyIn && token.momentum && token.ratio > 2) {
            const audit = await analyzeWithRedFlags(token);
            if (audit && audit.decision === "BUY" && audit.score > 85) {
                db.prepare("INSERT INTO portfolio (token, address, entry_price) VALUES (?, ?, ?)").run(token.token, token.address, token.price);
                bot.telegram.sendMessage(MY_CHAT_ID, `🟢 **INVERSIÓN REALIZADA ($50)**\nToken: ${token.token}\nConfianza: ${audit.score}%\nNota: ${audit.reason}`);
            } else if (audit && audit.decision === "ALERT") {
                bot.telegram.sendMessage(MY_CHAT_ID, `🚨 **POSIBLE SCAM DETECTADO:** ${token.token}\nRazones: ${audit.redflags.join(', ')}`);
            }
        }
    }
}

setInterval(coreLoop, 60000);
bot.launch();
console.log("🚀 Agente con Escudo Anti-Scams Iniciado.");
