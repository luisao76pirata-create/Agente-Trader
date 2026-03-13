import axios from "axios"; // Cambiamos a axios para mejor manejo de errores

const DEX_API = "https://api.dexscreener.com/latest/dex/search?q=solana"; // Endpoint más robusto
const RUGCHECK_API = "https://api.rugcheck.xyz/v1/tokens/";

let knownPools = new Set();

async function getRugScore(address) {
    try {
        const res = await axios.get(`${RUGCHECK_API}${address}/report`, { timeout: 5000 });
        return res.data?.score ?? null;
    } catch {
        return null;
    }
}

function analyzePair(pair) {
    const volume5m = pair.volume?.m5 || 0;
    const volume1h = pair.volume?.h1 || 0;
    const buys = pair.txns?.m5?.buys || 0;
    const sells = pair.txns?.m5?.sells || 0;

    const ratio = sells === 0 ? buys : buys / sells;

    // 1. MOMENTUM: Fuerza de compra actual
    const momentum = volume5m > 3000 && ratio > 1.3;

    // 2. WHALE SIGNAL: Compras grandes comparadas con ventas
    const whaleSignal = volume5m > 15000 && buys > (sells * 2);

    // 3. VOLUME SPIKE: Detecta tokens que despiertan tras semanas/meses
    // Si el volumen de 5 min es el 25% o más de todo el volumen de la última hora
    const volumeSpike = volume1h > 1000 && volume5m > (volume1h * 0.25);

    return { volume5m, volume1h, ratio, momentum, whaleSignal, volumeSpike };
}

export async function scanMarket() {
    try {
        console.log("🔍 Escaneando DexScreener (Filtros Pro + Rebirth)...");

        // Usamos axios para evitar el error de "Unexpected token <" (HTML)
        const res = await axios.get(DEX_API, { 
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 10000 
        });

        const data = res.data;
        if (!data.pairs) return [];

        const tokens = [];

        for (const pair of data.pairs) {
            if (!pair.baseToken || !pair.priceUsd || pair.chainId !== 'solana') continue;

            const liquidity = pair.liquidity?.usd || 0;
            if (liquidity < 15000) continue; // Filtro de seguridad mínimo

            const analysis = analyzePair(pair);
            let isInterested = false;
            let triggerReason = "";

            // --- LÓGICA DE DETECCIÓN ---
            
            // A) Lanzamiento Nuevo
            if (!knownPools.has(pair.pairAddress)) {
                knownPools.add(pair.pairAddress);
                isInterested = true;
                triggerReason = "🆕 NUEVO";
            }

            // B) Actividad de Ballenas
            if (analysis.whaleSignal) {
                isInterested = true;
                triggerReason = "🐋 WHALE";
            }

            // C) El Despertar (Tokens antiguos - Volume Spike)
            if (analysis.volumeSpike) {
                isInterested = true;
                triggerReason = "📈 DESPERTAR";
            }

            // D) Momentum puro
            if (analysis.momentum) {
                isInterested = true;
                triggerReason = "🔥 MOMENTUM";
            }

            if (isInterested) {
                const rugScore = await getRugScore(pair.baseToken.address);

                // Solo dejamos pasar si RugCheck da el visto bueno (Score bajo es bueno)
                if (rugScore !== null && rugScore < 100) { 
                    tokens.push({
                        token: pair.baseToken.symbol,
                        address: pair.baseToken.address,
                        price: Number(pair.priceUsd),
                        mcap: pair.fdv || 0,
                        liquidity: liquidity,
                        v5m: analysis.volume5m,
                        ratio: analysis.ratio,
                        momentum: true, // Para que index.js sepa que debe analizarlo
                        trigger: triggerReason,
                        rugcheckScore: rugScore
                    });
                }
            }
        }

        tokens.sort((a, b) => b.v5m - a.v5m);
        console.log(`📊 ${tokens.length} pares pasaron el pre-filtro.`);

        return tokens.slice(0, 50);

    } catch (err) {
        console.log("❌ Scanner error:", err.message);
        return [];
    }
}
