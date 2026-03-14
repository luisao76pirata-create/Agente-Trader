import axios from "axios";

// Múltiples búsquedas para capturar tokens activos en Solana
// en lugar de ?q=solana que devuelve el token SOL
const SEARCH_APIS = [
    "https://api.dexscreener.com/latest/dex/search?q=USDC%2FSOL",
    "https://api.dexscreener.com/latest/dex/search?q=SOL%2FUSDC",
    "https://api.dexscreener.com/latest/dex/search?q=RAY",
    "https://api.dexscreener.com/latest/dex/search?q=BONK",
];

// Usando /report/summary en lugar de /report — mismos datos, más rápido
const RUGCHECK_API = "https://api.rugcheck.xyz/v1/tokens/";

async function getRugScore(address) {
    try {
        const res = await axios.get(`${RUGCHECK_API}${address}/report/summary`, { timeout: 5000 });
        return res.data?.score ?? null;
    } catch { return null; }
}

export async function scanMarket() {
    try {
        console.log("📡 Patrullando mercado en busca de gemas...");

        // Recopilar pares de todos los endpoints y deduplicar por address
        let allPairs = [];
        const seen = new Set();

        for (const api of SEARCH_APIS) {
            try {
                const res = await axios.get(api, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    timeout: 15000
                });
                const pairs = res.data?.pairs || [];
                for (const pair of pairs) {
                    const addr = pair.baseToken?.address;
                    if (addr && !seen.has(addr)) {
                        seen.add(addr);
                        allPairs.push(pair);
                    }
                }
                console.log(`📡 ${api.split("q=")[1]}: ${pairs.length} pares`);
            } catch (e) {
                console.log(`⚠️ Error en endpoint ${api.split("q=")[1]}: ${e.message}`);
            }
        }

        if (allPairs.length === 0) return [];

        // Filtrar solo pares de Solana y tomar los primeros 40
        const pairs = allPairs
            .filter(p => p.chainId === "solana")
            .slice(0, 40);

        console.log(`🧐 Analizando ${pairs.length} pares únicos de Solana...`);

        const tokens = [];

        for (const pair of pairs) {
            const sym = pair.baseToken?.symbol || "";
            const addr = pair.baseToken?.address;

            // 1. FILTRO DE EXCLUSIÓN: No queremos comprar SOL ni monedas estables
            if (["SOL", "USDC", "USDT", "WSOL"].includes(sym.toUpperCase())) continue;

            const liq = pair.liquidity?.usd || 0;
            const vol5m = pair.volume?.m5 || 0;
            const vol1h = pair.volume?.h1 || 0;

            // 2. FILTRO DE SENSIBILIDAD
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
