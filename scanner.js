import axios from "axios";

const SEARCH_API = "https://api.dexscreener.com/latest/dex/search?q=solana";

export async function scanMarket() {
    try {
        console.log("📡 [DEBUG] Iniciando escaneo de precisión...");
        
        const res = await axios.get(SEARCH_API, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 15000
        });

        if (!res.data || !res.data.pairs) {
            console.log("⚠️ [DEBUG] DexScreener no devolvió pares.");
            return [];
        }

        const tokens = [];
        const pairs = res.data.pairs.slice(0, 30); // Miramos los primeros 30 para no saturar el log

        console.log(`🧐 [DEBUG] Analizando ${pairs.length} pares de la búsqueda...`);

        for (const pair of pairs) {
            const sym = pair.baseToken?.symbol || "UNK";
            const liq = pair.liquidity?.usd || 0;
            const vol5m = pair.volume?.m5 || 0;
            const vol1h = pair.volume?.h1 || 0;

            // Log de diagnóstico para entender qué está pasando
            if (liq < 10000) {
                // console.log(`❌ ${sym} rechazado: Liquidez baja ($${Math.round(liq)})`);
                continue;
            }

            const isSpike = vol1h > 500 && vol5m > (vol1h * 0.15);
            const isMomentum = vol5m > 2000;

            if (isSpike || isMomentum) {
                const buys = pair.txns?.m5?.buys || 0;
                const sells = pair.txns?.m5?.sells || 1;
                
                tokens.push({
                    token: sym,
                    address: pair.baseToken.address,
                    price: Number(pair.priceUsd),
                    liquidity: liq,
                    mcap: pair.fdv || 0,
                    v5m: vol5m,
                    ratio: buys / sells,
                    momentum: true,
                    trigger: isSpike ? "📈 DESPERTAR" : "🔥 MOMENTUM"
                });
                console.log(`✅ ${sym} PASÓ EL FILTRO! (Vol: $${vol5m})`);
            } else {
                // Descomenta la línea de abajo si quieres ver por qué fallan los que tienen liquidez
                // console.log(`⚠️ ${sym} tiene liquidez ($${liq}) pero poco volumen ($${vol5m})`);
            }
        }

        console.log(`📊 Fin del ciclo: ${tokens.length} candidatos encontrados.`);
        return tokens;

    } catch (err) {
        console.log("❌ Error en Scanner:", err.message);
        return [];
    }
}
