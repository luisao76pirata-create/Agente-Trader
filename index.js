import "dotenv/config"
import { Telegraf } from "telegraf"
import { scanMarket } from "./scanner.js"
import { generateSignal } from "./strategy.js"
import { Portfolio } from "./portfolio.js"

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN)
const portfolio = new Portfolio()

// ⚠️ PON AQUÍ TU NÚMERO DE ID (Sin comillas)
const MY_CHAT_ID = 745415554; 

console.log("🚀 Alpha-Centauri-01 booting - Fixed ID Mode")

async function tradingLoop() {
    try {
        const tokens = await scanMarket()
        console.log(`🔎 Scan: ${tokens.length} tokens found.`)
        
        for (const token of tokens) {
            const signal = generateSignal(token)
            if (!signal) continue

            const message = `🎯 ¡SEÑAL DETECTADA!\nToken: ${token.token}\nAcción: ${signal.action}\nConfianza: ${signal.confidence}%`
            console.log(message)
            
            // Ahora el bot sabe siempre a quién escribir
            await bot.telegram.sendMessage(MY_CHAT_ID, message).catch(e => console.log("Error enviando TG:", e.message))
            
            portfolio.openPosition(token.token, token.price, 1)
        }
    } catch (err) {
        console.error("Trading loop error:", err)
    }
}

// Iniciar bot con manejo de errores para evitar el 409
bot.launch().then(() => {
    console.log("✅ Conectado a Telegram");
}).catch(err => {
    console.error("Error al lanzar Telegram:", err.message);
});

tradingLoop()
setInterval(tradingLoop, 60000)
