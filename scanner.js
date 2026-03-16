import axios from "axios";

// --- ENDPOINTS ---
const PROFILES_API = "https://api.dexscreener.com/token-profiles/latest/v1";
const PAIRS_API = "https://api.dexscreener.com/latest/dex/tokens/";
const RUGCHECK_API = "https://api.rugcheck.xyz/v1/tokens/";

// --- CONFIGURACIÓN IA AGENTS ---
const AI_KEYWORDS = ["AI", "AGENT", "BOT", "NEURAL", "AUTONOMOUS", "MIND", "VIRTUAL", "SENTIENT", "ELIZA", "GOV"];

// --- MEMORIA DE SCAMS ---
let mutedScams = new Set();

/**
 * Consulta la seguridad del token en RugCheck
 */
async function getRugScore(address) {
    try {
        const res = await axios.get(`${RUGCHECK_API}${address}/report`, { timeout: 5000 });
        return res.data?.score ?? null;
    } catch {
        return null;
    }
}

/**
 * Scanner principal: Rebirths + IA Agents
 */
export async function scanMarket() {
    try {
        console.log("🔍 Patrullando: Perfiles Actualizados + Narrativa IA...");
        
        // 1. Obtener perfiles recientes
        const profileRes = await axios.get(PROFILES_API);
        if (!profileRes.data || !Array.isArray(profileRes.data)) {
            console.log("⚠️ No se recibieron perfiles recientes.");
            return [];
        }

        const solanaProfiles = profileRes.data
            .filter(t => t.chainId === 'solana')
            .slice(0, 30); // Ampliamos un poco el rango para no perdernos nada

        if (solanaProfiles.length === 0) {
            console.log("⏳ No hay perfiles de Solana actualizados.");
            return [];
        }

        const addresses = solanaProfiles.map(t => t.tokenAddress).join(',');
        
        // 2. Obtener datos de mercado
        const pairsRes = await axios.get(`${PAIRS_API}${addresses}`);
        if (!pairsRes.data?.pairs) {
            console.log("⚠️ No hay datos de mercado disponibles.");
            return [];
        }

        const tokens = [];
        const pairs = pairsRes.data.pairs;

        for (const pair of pairs) {
            const sym = pair.baseToken?.symbol || "UNK";
            const name = pair.baseToken?.name || "";
            const addr = pair.baseToken?.address;

            // Filtro de Gigantes
            const giants = ["SOL", "USDC", "USDT", "RAY", "BONK", "JUP", "PYTH", "WIF"];
            if (giants.includes(sym.toUpperCase())) continue;

            const liq = pair.liquidity?.usd || 0;
            const vol5m = pair.volume?.m5 || 0;
            const vol1h = pair.volume?.h1 || 0;

            // --- DETECTOR DE NARRATIVA IA ---
            const fullText = (name + " " + sym).toUpperCase();
            const isAIAgent = AI_KEYWORDS.some(word => fullText.includes(word));

            // Filtros dinámicos: Los Agentes de IA suelen tener menos liquidez inicial pero más interés
            const minLiq = isAIAgent ? 6000 : 7000;
            const volThreshold = isAIAgent ? 1000 : 1500;

            const hasMomentum = vol5m > volThreshold;
            const isWakingUp = vol1h > 5000 && vol5m > 500;

            if (hasMomentum || isWakingUp) {
                // 3. Auditoría RugCheck
                const rugScore = await getRugScore(addr);

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
                        trigger: isAIAgent ? "🤖 AI AGENT" : "🔄 REBIRTH",
                        rugcheckScore: rugScore
                    });
                    
                    const icon = isAIAgent ? "🤖" : "🌟";
                    console.log(`${icon} DETECTADO: ${sym} | Liq: $${Math.round(liq)} | Trigger: ${isAIAgent ? 'AI Agent' : 'Rebirth'}`);
                    
                } else if (rugScore >= 200) {
                    if (!mutedScams.has(addr)) {
                        console.log(`🚫 ${sym} descartado: Riesgo alto (${rugScore}). Silenciando...`);
                        mutedScams.add(addr);
                        if (mutedScams.size > 200) mutedScams.clear();
                    }
                }
            }
        }

        console.log(`✅ Ciclo finalizado: ${tokens.length} candidatos encontrados.`);
        return tokens;

    } catch (err) {
        console.log("❌ Error en Scanner:", err.message);
        return [];
    }
}
