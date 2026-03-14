import axios from "axios";

const SEARCH_API = "https://api.dexscreener.com/latest/dex/search?q=solana";
const RUGCHECK_API = "https://api.rugcheck.xyz/v1/tokens/";

async function getRugScore(address) {
    try {
        const res = await axios.get(`${RUGCHECK_API}${address}/report`, { timeout: 5000 });
        return res.data?.score ?? null;
    } catch { return null; }
}

export async function scanMarket() {
    try {
        console.log("📡 Patrullando mercado en busca de gemas...");
        
        const res = await axios.get(SEARCH_API, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 15000
        });

        if (!res.data?.pairs) return [];

        const tokens = [];
        const pairs = res.data.pairs.slice(0, 40);

        for (const pair of pairs) {
            const sym = pair.baseToken?.symbol || "";
            const addr = pair.baseToken?.address;

            // 1. FILTRO DE EXCLUSIÓN: No queremos comprar SOL ni monedas estables
            if (["SOL", "USDC", "USDT", "WSOL"].includes(sym.toUpperCase())) continue;

            const liq = pair.liquidity?.usd || 0;
            const vol5m = pair.volume?.m5 || 0;
            const vol1h = pair.volume?.h1 || 0;

            // 2. FILTRO DE SENSIBILIDAD (Modo Test)
            if (liq < 10000) continue;

            const isSpike = vol1h > 500 && vol5m > (vol1h * 0.15);
            const isMomentum = vol5m > 2000;

            if (isSpike || isMomentum) {
                // 3. AUDITORÍA DE SEGURIDAD (RugCheck)
                const rugScore = await getRugScore(addr);
                
                // Score < 100 significa que el riesgo es bajo/aceptable
                if (rugScore !== null && rugScore < 100) {
                    const buys = pair.txns?.m5?.buys || 0;
                    const sells = pair.txns?.m5?.sells || 1;

                    tokens.push({
                        token: sym,
                        address: addr,
                        price: Number(pair.priceUsd),
                        liquidity: liq,
                        mcap: pair.fdv || 0,
                        v5m: vol5m,
                        ratio: buys / sells,
                        momentum: true,
                        trigger: isSpike ? "📈 DESPERTAR" : "🔥 MOMENTUM",
                        rugcheckScore: rugScore
                    });
                    console.log(`💎 GEMA DETECTADA: ${sym} (Vol: $${Math.round(vol5m)}) - RugScore: ${rugScore}`);
                } else {
                    console.log(`🚫 ${sym} descartado por riesgo RugCheck (${rugScore})`);
                }
            }
        }

        console.log(`📊 Ciclo finalizado: ${tokens.length} candidatos para la IA.`);
        return tokens;

    } catch (err) {
        console.log("❌ Error en Scanner:", err.message);
        return [];
    }
}
