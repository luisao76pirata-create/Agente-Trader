import axios from "axios";

const SEARCH_API = "https://api.dexscreener.com/latest/dex/search?q=solana";
const RUGCHECK_API = "https://api.rugcheck.xyz/v1/tokens/";

export async function scanMarket() {
    try {
        console.log("📡 Consultando DexScreener via Search API...");
        
        const res = await axios.get(SEARCH_API, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' 
            },
            timeout: 15000
        });

        if (!res.data || !res.data.pairs) {
            console.log("⚠️ Sin datos en la respuesta.");
            return [];
        }

        const tokens = [];
        const pairs = res.data.pairs.slice(0, 40); 

        for (const pair of pairs) {
            if (pair.chainId !== 'solana' || !pair.baseToken) continue;

            const liq = pair.liquidity?.usd || 0;
            const vol5m = pair.volume?.m5 || 0;
            const vol1h = pair.volume?.h1 || 0;
            
            // --- FIX: Calculamos el Ratio para la IA ---
            const buys = pair.txns?.m5?.buys || 0;
            const sells = pair.txns?.m5?.sells || 1; // Evitamos dividir por cero
            const ratio = buys / sells;

            if (liq < 15000) continue;

            // LÓGICA REBIRTH: Bajamos un pelín el volumen a 3500 para detectar más candidatos
            const isSpike = vol1h > 500 && vol5m > (vol1h * 0.20);
            
            if (isSpike || vol5m > 3500) {
                tokens.push({
                    token: pair.baseToken.symbol,
                    address: pair.baseToken.address,
                    price: Number(pair.priceUsd),
                    liquidity: liq,
                    mcap: pair.fdv || 0,
                    v5m: vol5m,
                    ratio: ratio, // 🟢 Ahora el ratio existe y no dará error
                    momentum: true,
                    trigger: isSpike ? "📈 DESPERTAR" : "🔥 MOMENTUM"
                });
            }
        }

        console.log(`✅ ${tokens.length} candidatos potenciales encontrados.`);
        return tokens;

    } catch (err) {
        if (err.response && err.response.data && typeof err.response.data === 'string' && err.response.data.includes('DOCTYPE')) {
            console.log("🚫 Bloqueo temporal (Cloudflare). Esperando...");
        } else {
            console.log("❌ Error en Scanner:", err.message);
        }
        return [];
    }
}
