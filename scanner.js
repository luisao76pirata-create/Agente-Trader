import axios from "axios";

// --- ENDPOINTS ---
const PROFILES_API = "https://api.dexscreener.com/token-profiles/latest/v1";
const PAIRS_API = "https://api.dexscreener.com/latest/dex/tokens/";
const RUGCHECK_API = "https://api.rugcheck.xyz/v1/tokens/";

/**
 * Consulta la seguridad del token en RugCheck
 */
async function getRugScore(address) {
    try {
        const res = await axios.get(`${RUGCHECK_API}${address}/report`, { timeout: 5000 });
        // Un score de 0 es ideal, más de 500 es peligroso.
        return res.data?.score ?? null;
    } catch {
        return null;
    }
}

/**
 * Scanner principal orientado a Resurrecciones (Rebirths)
 */
export async function scanMarket() {
    try {
        console.log("🔍 Buscando tokens con perfiles actualizados (Señal de Rebirth)...");
        
        // 1. Obtener tokens que acaban de actualizar info (redes, logo, etc)
        const profileRes = await axios.get(PROFILES_API);
        if (!profileRes.data || !Array.isArray(profileRes.data)) {
            console.log("⚠️ No se recibieron perfiles recientes.");
            return [];
        }

        // Filtramos solo los de Solana y tomamos los 20 más frescos
        const solanaProfiles = profileRes.data
            .filter(t => t.chainId === 'solana')
            .slice(0, 25);

        if (solanaProfiles.length === 0) {
            console.log("⏳ No hay perfiles de Solana actualizados ahora mismo.");
            return [];
        }

        const addresses = solanaProfiles.map(t => t.tokenAddress).join(',');
        
        // 2. Obtener datos de mercado (Precio, Volumen, Liquidez)
        const pairsRes = await axios.get(`${PAIRS_API}${addresses}`);
        if (!pairsRes.data?.pairs) {
            console.log("⚠️ No se encontraron datos de mercado para estos perfiles.");
            return [];
        }

        const tokens = [];
        const pairs = pairsRes.data.pairs;

        for (const pair of pairs) {
            const sym = pair.baseToken?.symbol || "UNK";
            const addr = pair.baseToken?.address;

            // --- FILTRO DE EXCLUSIÓN ---
            // Evitamos gigantes que suelen actualizar perfiles por mantenimiento
            const giants = ["SOL", "USDC", "USDT", "RAY", "BONK", "JUP", "PYTH", "WIF"];
            if (giants.includes(sym.toUpperCase())) continue;

            const liq = pair.liquidity?.usd || 0;
            const vol5m = pair.volume?.m5 || 0;
            const vol1h = pair.volume?.h1 || 0;

            // --- FILTROS DE TEST (SENSIBLES) ---
            // Bajamos un poco la liquidez a $7,000 porque los rebirths suelen empezar desde abajo
            if (liq < 7000) continue; 

            // Condición de entrada: volumen mínimo de $1,500 en 5 min o volumen sostenido
            const hasMomentum = vol5m > 1500;
            const isWakingUp = vol1h > 5000 && vol5m > 500;

            if (hasMomentum || isWakingUp) {
                // 3. AUDITORÍA DE SEGURIDAD
                const rugScore = await getRugScore(addr);

                // Solo si el score es "bajo" (riesgo aceptable)
                if (rugScore !== null && rugScore < 200) {
                    const buys = pair.txns?.m5?.buys || 1;
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
                        trigger: "🔄 REBIRTH/PROFILE",
                        rugcheckScore: rugScore
                    });
                    console.log(`🌟 POSIBLE RESURRECCIÓN: ${sym} | Liq: $${Math.round(liq)} | Rug: ${rugScore}`);
                } else if (rugScore >= 200) {
                    console.log(`🚫 ${sym} descartado: Riesgo RugCheck alto (${rugScore})`);
                }
            }
        }

        console.log(`✅ Ciclo finalizado: ${tokens.length} candidatos encontrados.`);
        return tokens;

    } catch (err) {
        console.log("❌ Error en Scanner Rebirth:", err.message);
        return [];
    }
}
