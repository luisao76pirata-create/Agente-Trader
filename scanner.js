import axios from "axios"

export async function scanMarket() {

    const url =
    "https://api.dexscreener.com/latest/dex/search?q=solana"

    const response = await axios.get(url)

    const pairs = response.data.pairs || []

    const tokens = pairs
        .filter(p => p.chainId === "solana")
        .filter(p => p.liquidity?.usd > 50000)
        .filter(p => p.volume?.h24 > 100000)
        .map(p => ({
            token: p.baseToken.symbol,
            price: Number(p.priceUsd),
            volume24h: p.volume.h24
        }))

    return tokens
}
