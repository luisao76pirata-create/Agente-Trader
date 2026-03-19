import "dotenv/config";
import { Telegraf } from "telegraf";
import Database from "better-sqlite3";
import OpenAI from "openai";
import axios from "axios";
import { Connection, Keypair, VersionedTransaction, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { scanMarket } from "./scanner.js";

console.log("✅ Imports OK (Solana Web3 + Jupiter v6)");

// --- CONFIGURACIÓN CONEXIÓN SOLANA REAL ---
const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const wallet = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_PRIVATE_KEY));
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const db = new Database("alpha_centauri.db");

console.log("🎬 Iniciando motor Alpha-Centauri v6.2...");
console.log("🏦 Wallet detectada:", wallet.publicKey.toString());
console.log("📅 Hora actual:", new Date().toLocaleString());

const MY_CHAT_ID = 745415554;
const WEBHOOK_URL = "https://eliza-production-567e.up.railway.app";
const PORT = 8080;

// --- PARÁMETROS ESTRATÉGICOS ---
const TRADE_SIZE_SOL = 0.50; // 🎯 0.5 SOL por operación
const STOP_LOSS_INITIAL = -12;
const TRAILING_STOP_DIST = -10;
const MAX_OPEN_TRADES = 2;

// --- FILTROS DE MARKET CAP v6.2 ---
const MIN_MCAP_BUY = 200000;        // 🛡️ Suelo subido a $200k para evitar "humo"
const UMBRAL_MURO_ENTRY = 700000;   // Si entramos < 700k, usamos el muro de 950k
const MCAP_LIMIT_EXIT = 950000;     // El muro psicológico

// --- INICIALIZACIÓN DE BASE DE DATOS ---
db.prepare(`CREATE TABLE IF NOT EXISTS portfolio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT, address TEXT, entry_price REAL, entry_mcap REAL,
    highest_price REAL, exit_price REAL,
    pnl_usd REAL, status TEXT DEFAULT 'OPEN', timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

// Asegurar que todas las columnas existen (Migración silenciosa)
const tableInfo = db.prepare("PRAGMA table_info(portfolio)").all();
if (!tableInfo.some(col => col.name === 'highest_price')) db.prepare("ALTER TABLE portfolio ADD COLUMN highest_price REAL").run();
if (!tableInfo.some(col => col.name === 'entry_mcap')) db.prepare("ALTER TABLE portfolio ADD COLUMN entry_mcap REAL").run();

console.log("✅ Tablas DB OK");

// --- MOTOR DE EJECUCIÓN (JUPITER) ---
async function executeSwap(inputMint, outputMint, amountInLamports) {
    try {
        const quote = await axios.get(`https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountInLamports}&slippageBps=300`);
        const { data: { swapTransaction } } = await axios.post("https://quote-api.jup.ag/v6/swap", {
            quoteResponse: quote.data,
            userPublicKey: wallet.publicKey.toString(),
            wrapAndUnwrapSol: true
        });
        const swapBuf = Buffer.from(swapTransaction, 'base64');
        const transaction = VersionedTransaction.deserialize(swapBuf);
        transaction.sign([wallet]);
        
        // --- LÓGICA REAL (MANTENER COMENTADA PARA TEST SI SE DESEA) ---
        const txid = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true });
        await connection.confirmTransaction(txid, "confirmed");
        return txid;
        
        // return "SIMULATED_TX_ID"; 
    } catch (e) {
        console.error("❌ Error en Swap:", e.message);
        return null;
    }
}

async function sellAllTokens(tokenAddress) {
    try {
        const mint = new PublicKey(tokenAddress);
        const accounts = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, { mint });
        if (accounts.value.length === 0) return null;
        const amount = accounts.value[0].account.data.parsed.info.tokenAmount.amount;
        
        // return await executeSwap(tokenAddress, "So11111111111111111111111111111111111111112", amount);
        return "SIMULATED_SELL_ID";
    } catch (e) {
        console.error("❌ Error en sellAllTokens:", e.message);
        return null;
    }
}

// --- IA ANALISTA (v6.2 CON FOCO EN SUELOS Y BALLENAS) ---
async function analyzeWithAI(token) {
    const prompt = `Analiza este token de Solana para una posible inversión.
Trigger: ${token.trigger}
Token: ${token.token} | MCap: $${token.mcap} | Liq: $${token.liquidity}
Volumen 5m: $${token.v5m} | Ratio B/S: ${token.ratio ? token.ratio.toFixed(2) : "1"}
RugCheck Score: ${token.rugcheckScore}

INSTRUCCIONES CRÍTICAS v6.2:
1. CONCENTRACIÓN: Si detectas que los holders principales (Whales) tienen > 25% del suministro, responde SKIP.
2. PATRÓN DE SUELO (DIP): Evalúa si el token ha corregido tras un pump y ahora está consolidando (lateral) con volumen estable. Valora positivamente este "suelo".
3. Si el volumen es alto pero el precio lateral, evalúa si es una fase de ACUMULACIÓN.
4. Penaliza severamente (Score < 30) si la liquidez es baja en relación al MCAP.

Responde estrictamente en JSON:
{
"decision":"BUY|SKIP",
"score":0-100,
"reason":"explicación sobre concentración/patrón técnico",
"pattern": "DIP|BREAKOUT|NONE"
}`;

    try {
        const res = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "Eres un analista de Smart Money experto en detectar acumulación de ballenas y suelos técnicos en Solana." },
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
    const profitUsd = ((exitPrice - entryPrice) / entryPrice) * (TRADE_SIZE_SOL * 90); 
    db.prepare("UPDATE portfolio SET status = 'CLOSED', exit_price = ?, pnl_usd = ? WHERE id = ?").run(exitPrice, profitUsd, id);

    const emoji = profitUsd > 0 ? "💰" : "🛑";
    await bot.telegram.sendMessage(MY_CHAT_ID,
        `${emoji} **CIERRE (SIMULADO): ${tokenName}**\n` +
        `Motivo: ${reason}\n` +
        `Resultado estimado: $${profitUsd.toFixed(2)} (${((exitPrice - entryPrice)/entryPrice*100).toFixed(2)}%)`,
        { parse_mode: 'Markdown' });
}

async function sendReport() {
    try {
        const stats = db.prepare(`SELECT SUM(pnl_usd) as total, COUNT(*) as count FROM portfolio WHERE status='CLOSED' AND timestamp > date('now')`).get();
        const open = db.prepare(`SELECT count(*) as count FROM portfolio WHERE status='OPEN'`).get();

        const msg = `📊 **REPORTE ALPHA-CENTAURI**\n\n` +
                    `💵 PnL Realizado (Hoy): \`$${(stats.total || 0).toFixed(2)}\`\n` +
                    `🔄 Trades cerrados: ${stats.count}\n` +
                    `⏳ Trades abiertos: ${open.count}/${MAX_OPEN_TRADES}\n\n` +
                    `🏦 Saldo Wallet: [Consultar con /balance]`;

        await bot.telegram.sendMessage(MY_CHAT_ID, msg, { parse_mode: 'Markdown' });
    } catch (e) { console.error("Error Report:", e.message); }
}

// --- CORE LOOP ---
async function coreLoop() {
    const timestamp = new Date().toLocaleTimeString();
    try {
        console.log(`\n[${timestamp}] 🔄 Escaneando mercado (Filtro Min: $${MIN_MCAP_BUY})...`);
        const tokens = await scanMarket();

        if (!tokens || tokens.length === 0) {
            console.log(`[${timestamp}] ℹ️ Sin candidatos.`);
            return;
        }

        const openPositions = db.prepare("SELECT * FROM portfolio WHERE status = 'OPEN'").all();

        // 1. MONITORIZACIÓN DE SALIDAS
        for (const pos of openPositions) {
            const live = tokens.find(t => t.address === pos.address);
            if (live) {
                const currentPrice = live.price;
                const currentMCAP = live.mcap;

                const applyMuro = pos.entry_mcap < UMBRAL_MURO_ENTRY;
                const hitMuro = currentMCAP >= MCAP_LIMIT_EXIT;

                if (applyMuro && hitMuro) {
                    console.log(`🎯 [${pos.token}] Muro alcanzado. Ejecutando salida.`);
                    await closeTrade(pos.id, currentPrice, pos.entry_price, pos.token, `Muro Psicológico (${(currentMCAP/1000).toFixed(0)}k MCAP)`);
                    continue;
                }

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

        // 2. NUEVAS ENTRADAS (RANKING Y TRANSPARENCIA)
        if (openPositions.length < MAX_OPEN_TRADES) {
            tokens.sort((a, b) => {
                const scoreA = (a.v5m * (a.ratio || 1)) * (a.earlyPump ? 2 : 1) * (a.secondLeg ? 2.5 : 1) * (a.volumeSpike ? 1.5 : 1);
                const scoreB = (b.v5m * (b.ratio || 1)) * (b.earlyPump ? 2 : 1) * (b.secondLeg ? 2.5 : 1) * (b.volumeSpike ? 1.5 : 1);
                return scoreB - scoreA;
            });

            for (const token of tokens) {
                // Razón 1: MCAP insuficiente
                if (token.mcap < MIN_MCAP_BUY) {
                    console.log(`📌 [${token.token}] Descartado: MCAP bajo ($${(token.mcap/1000).toFixed(0)}k < 200k)`);
                    continue;
                }

                const alreadyIn = db.prepare("SELECT id FROM portfolio WHERE address = ? AND status = 'OPEN'").get(token.address);
                const recentlyClosed = db.prepare("SELECT id FROM portfolio WHERE address = ? AND status = 'CLOSED' AND timestamp > datetime('now', '-4 hours')").get(token.address);

                // Razón 2: Ya operado o en cartera
                if (alreadyIn) {
                    console.log(`📌 [${token.token}] Descartado: Ya está en cartera activa.`);
                    continue;
                }
                if (recentlyClosed) {
                    console.log(`📌 [${token.token}] Descartado: Operado hace menos de 4h.`);
                    continue;
                }

                console.log(`🧠 [${token.token}] IA Analizando... (MCAP: $${(token.mcap/1000).toFixed(0)}k)`);
                const audit = await analyzeWithAI(token);
                
                const scoreThreshold = token.earlyPump ? 50 : token.secondLeg ? 55 : 60;

                if (audit) {
                    // Razón 3: La IA dice SKIP
                    if (audit.decision === "SKIP") {
                        console.log(`❌ [${token.token}] IA rechazó (SKIP). Motivo: ${audit.reason}`);
                    } 
                    // Razón 4: Score por debajo del umbral
                    else if (audit.score <= scoreThreshold) {
                        console.log(`⚠️ [${token.token}] IA Score bajo (${audit.score}% < ${scoreThreshold}%). Motivo: ${audit.reason}`);
                    } 
                    // ✅ APROBADO
                    else {
                        console.log(`✅ [${token.token}] APROBADO con ${audit.score}% (Patrón: ${audit.pattern})`);
                        
                        db.prepare("INSERT INTO portfolio (token, address, entry_price, entry_mcap, highest_price) VALUES (?, ?, ?, ?, ?)")
                          .run(token.token, token.address, token.price, token.mcap, token.price);

                        await bot.telegram.sendMessage(MY_CHAT_ID,
                            `🟢 **COMPRA DETECTADA ($${(TRADE_SIZE_SOL * 90).toFixed(0)})**\n` +
                            `Token: ${token.token}\n` +
                            `Patrón IA: ${audit.pattern} | Confianza: ${audit.score}%\n` +
                            `Nota: ${audit.reason}`, { parse_mode: 'Markdown' });
                        break; 
                    }
                } else {
                    console.log(`⚠️ [${token.token}] IA no respondió al análisis.`);
                }
            }
        } else {
            console.log(`⏳ Cartera llena (${openPositions.length}/${MAX_OPEN_TRADES}). No se buscan nuevas entradas.`);
        }
}
// --- COMANDOS ---
bot.command('status', (ctx) => {
    const open = db.prepare("SELECT * FROM portfolio WHERE status = 'OPEN'").all();
    if (open.length === 0) return ctx.reply("🛒 Cartera vacía.");

    let m = "🛒 **Cartera Activa:**\n\n";
    open.forEach(p => {
        const highest = p.highest_price || p.entry_price;
        const currentSL = highest * (1 + (TRAILING_STOP_DIST/100));
        m += `• **${p.token}**\n  Entrada: $${p.entry_price.toFixed(6)} (MCAP: $${p.entry_mcap ? (p.entry_mcap/1000).toFixed(0) : '?'}k)\n  Máx: $${highest.toFixed(6)}\n  SL Actual: $${currentSL.toFixed(6)}\n\n`;
    });
    ctx.reply(m, { parse_mode: 'Markdown' });
});

bot.command('report', () => sendReport());

bot.command('balance', async (ctx) => {
    try {
        const balance = await connection.getBalance(wallet.publicKey);
        ctx.reply(`💰 **Saldo Real en Wallet:**\n\n\`${(balance / 1e9).toFixed(4)} SOL\``, { parse_mode: 'Markdown' });
    } catch (e) {
        ctx.reply("❌ Error al consultar saldo en la Blockchain.");
    }
});

bot.command('panic', async (ctx) => {
    const open = db.prepare("SELECT * FROM portfolio WHERE status = 'OPEN'").all();
    for (const p of open) {
        await closeTrade(p.id, p.entry_price * 0.90, p.entry_price, p.token, "PÁNICO");
    }
    ctx.reply("🛑 PÁNICO: Todas las posiciones cerradas (Simulado).");
});

// --- INICIO CON WEBHOOK ---
const startBot = async () => {
    try {
        console.log("✅ startBot() ejecutándose...");
        await bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook`);
        console.log(`✅ Webhook configurado: ${WEBHOOK_URL}/webhook`);

        bot.startWebhook("/webhook", null, PORT);
        console.log(`🚀 Alpha-Centauri v6.2: Online en puerto ${PORT}`);

        coreLoop();
        setInterval(coreLoop, 120000); 
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
