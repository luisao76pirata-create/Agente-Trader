import "dotenv/config"
import { scanMarket } from "./scanner.js"

async function runBot() {

    console.log("🚀 Alpha-Centauri-01 starting")

    async function loop() {

        try {

            const tokens = await scanMarket()

            console.log("Tokens detected:", tokens.length)

            tokens.slice(0,5).forEach(t => {
                console.log(
                    `${t.token} | price ${t.price} | vol ${t.volume24h}`
                )
            })

        } catch (err) {

            console.error("Scan error:", err)

        }

    }

    await loop()

    setInterval(loop, 60000)

}

runBot()
