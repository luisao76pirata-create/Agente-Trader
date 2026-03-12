import "dotenv/config"
import { Telegraf } from "telegraf"
import { scanMarket } from "./scanner.js"
import { generateSignal } from "./strategy.js"
import { Portfolio } from "./portfolio.js"

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN)
const portfolio = new Portfolio()

// Sustituye esto por tu ID de Telegram si lo conoces, 
// o el bot te lo dirá al escribirle /id
let myChatId = null;

console.log("🚀 Alpha-Centauri-01 booting with Telegram support")

async function tradingLoop() {
    try {
        const tokens = await scanMarket()
        console.log(`🔎 Scan: ${tokens.length} tokens found.`)
        
        for (const token of tokens) {
            const signal = generateSignal(token)
            if (!signal) continue

            const message = `🎯 ¡SEÑAL DETECTADA!\nToken: ${token.token}\nAcción: ${signal.action}\nConfianza: ${signal.confidence}%`
            console.log(message)
            
            if (myChatId) bot.telegram.sendMessage(myChatId, message)
            
            portfolio.openPosition(token.token, token.price, 1)
        }
    } catch (err) {
        console.error("Trading loop error:", err)
    }
}

// Comando para saber tu ID y conectar el bot contigo
bot.command('start', (ctx) => {
    myChatId = ctx.chat.id
    ctx.reply(`✅ Alpha-Centauri-01 conectado. Tu ID es ${myChatId}. Empezaré a reportar aquí.`)
})

bot.launch()
tradingLoop()
setInterval(tradingLoop, 60000)
