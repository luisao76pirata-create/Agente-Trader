import axios from "axios";

const SEARCH_API = "https://api.dexscreener.com/latest/dex/search?q=solana";
const RUGCHECK_API = "https://api.rugcheck.xyz/v1/tokens/";

export async function scanMarket() {
    try {
        console.log("📡 Consultando DexScreener via Search API...");
        
        // Usamos un User-Agent real para que DexScreener no nos bloquee
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
        const pairs = res.data.pairs.slice(0, 40); // Analizamos los 40 más activos

        for (const pair of pairs) {
            if (pair.chainId !== 'solana' || !pair.baseToken) continue;

            const liq = pair.liquidity?.usd || 0;
            const vol5m = pair.volume?.m5 || 0;
            const vol1h = pair.volume?.h1 || 0;

            if (liq < 15000) continue;

            // LÓGICA REBIRTH: Token antiguo que despierta
            // Si el volumen de 5m es más del 20% del volumen de 1h
            const isSpike = vol1h > 1000 && vol5m > (vol1h * 0.20);
            
            if (isSpike || vol5m > 5000) {
                tokens.push({
                    token: pair.baseToken.symbol,
                    address: pair.baseToken.address,
                    price: Number(pair.priceUsd),
                    liquidity: liq,
                    mcap: pair.fdv || 0,
                    v5m: vol5m,
                    momentum: true, // Para que index.js lo procese
                    trigger: isSpike ? "📈 DESPERTAR" : "🔥 MOMENTUM"
                });
            }
        }

        console.log(`✅ ${tokens.length} candidatos potenciales encontrados.`);
        return tokens;

    } catch (err) {
        // Aquí atrapamos el error del HTML (DOCTYPE) para que no rompa el bot
        if (err.response && err.response.data && typeof err.response.data === 'string' && err.response.data.includes('DOCTYPE')) {
            console.log("🚫 Bloqueo temporal de DexScreener (Cloudflare). Esperando próximo ciclo...");
        } else {
            console.log("❌ Error en Scanner:", err.message);
        }
        return [];
    }
}
