export function generateSignal(token) {
    let score = 0

    // Puntos por Liquidez (Si tiene dinero, es más fiable)
    if (token.liquidity > 50000) score += 1
    if (token.liquidity > 200000) score += 2

    // Puntos por Volumen (Si hay mucha gente comprando)
    if (token.volume24h > 100000) score += 1
    if (token.volume24h > 500000) score += 2

    // Puntos por Movimiento de Precio (Adrenalina)
    if (token.change1h > 2) score += 1
    if (token.change1h > 10) score += 2

    // UMBRAL: Antes era 6, ahora con 3 ya te avisará
    if (score >= 3) {
        return {
            action: "BUY",
            confidence: Math.min(score * 15, 99)
        }
    }

    return null
}
