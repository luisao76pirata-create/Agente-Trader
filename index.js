import "dotenv/config"

import { scanMarket } from "./scanner.js"
import { generateSignal } from "./strategy.js"
import { simulateTrade } from "./simulator.js"
import { Portfolio } from "./portfolio.js"

const portfolio = new Portfolio()

console.log("🚀 Alpha-Centauri-01 booting")

async function tradingLoop() {

    try {

        console.log("🔎 Scanning market...")

        const tokens = await scanMarket()

        console.log("Tokens found:", tokens.length)

        for (const token of tokens) {

            const signal = generateSignal(token)

            if (!signal) continue

            console.log(
                `Signal detected: ${token.token} confidence ${signal.confidence}`
            )

            const trade = {
                token: token.token,
                price: token.price,
                action: signal.action,
                size: 1
            }

            portfolio.openPosition(token.token, token.price, 1)

            simulateTrade(trade)

        }

        console.log("💰 Portfolio balance:", portfolio.balance)

    } catch (err) {

        console.error("Trading loop error:", err)

    }

}

tradingLoop()

setInterval(tradingLoop, 60000)
