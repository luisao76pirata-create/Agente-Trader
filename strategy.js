export function generateSignal(token) {

    let score = 0

    if (token.liquidity > 100000) score += 2
    if (token.volume24h > 300000) score += 3
    if (token.change1h > 5) score += 2
    if (token.change1h > 15) score += 3

    if (score >= 6) {

        return {
            action: "BUY",
            confidence: Math.min(score * 10, 95)
        }

    }

    return null
}
