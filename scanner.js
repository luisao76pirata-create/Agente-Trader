import axios from "axios";

// --- ENDPOINTS ---
// Usamos búsquedas específicas para capturar tokens con más mcap y actividad real
const SEARCH_ENDPOINTS = [
    "https://api.dexscreener.com/latest/dex/search?q=SOL",
    "https://api.dexscreener.com/latest/dex/search?q=AI",
    "https://api.dexscreener.com/latest/dex/search?q=AGENT",
];
const PROFILES_API = "https://api.dexscreener.com/token-profiles/latest/v1";
const PAIRS_API = "https://api.dexscreener.com/latest/dex/tokens/";
const RUGCHECK_API = "https://api.rugcheck.xyz/v1/tokens/";

// --- CONFIG ---
const AI_KEYWORDS = ["AI", "AGENT", "BOT", "NEURAL", "AUTONOMOUS", "MIND", "VIRTUAL", "SENTIENT", "ELIZA", "GOV"];
const GIANTS = ["SOL", "USDC", "USDT", "RAY", "BONK", "JUP", "PYTH", "WIF", "WSOL"];
const MIN_LIQUIDITY = 20000;   // Subido a $20k para más calidad
const MAX_RUGCHECK = 100;      // Volvemos a < 100 para más seguridad
const MIN_MCAP = 50000;        // Pre-filtro mcap en scanner (el index filtra > 200k)

let mutedScams = new Set();

async function getRugScore(address) {
    try {
        const res = await axios.get(`${RUGCHECK_API}${address}/report/summary`, { timeout: 5000 });
        return res.data?.score ?? null;
    } catch {
        return null;
    }
}

// Recoge pares de múltiples fuentes y deduplica
async function collectPairs() {
    const seen = new Set();
    let allPairs = [];

    // Fuente 1: Búsquedas por keyword (tokens con más mcap y actividad)
    for (const url of SEARCH_ENDPOINTS) {
        try {
            const res = await axios.get(url, {
                headers: { "User-Agent": "Mozilla/5.0" },
                timeout: 10000
            });
            const pairs = (res.data?.pairs || []).filter(p => p.chainId === "solana");
            for (const pair of pairs) {
                const addr = pair.baseToken?.address;
                if (addr && !seen.has(addr)) {
                    seen.add(addr);
                    allPairs.push(pair);
                }
            }
        } catch (e) {
            console.log(`⚠️ Error en ${url.split("q=")[1]}: ${e.message}`);
        }
    }

    // Fuente 2: Perfiles recientes (tokens con momentum nuevo)
    try {
        const profileRes = await axios.get(PROFILES_API, { timeout: 10000 });
        if (Array.isArray(profileRes.data)) {
            const solanaProfiles = profileRes.data
                .filter(t => t.chainId === "solana")
                .slice(0, 20);

            if (solanaProfiles.length > 0) {
                const addresses = solanaProfiles
                    .map(t => t.tokenAddress)
                    .filter(addr => !seen.has(addr))
                    .join(",");

                if (addresses.length > 0) {
                    const pairsRes = await axios.get(`${PAIRS_API}${addresses}`, { timeout: 10000 });
                    for (const pair of (pairsRes.data?.pairs || [])) {
                        const addr = pair.baseToken?.address;
                        if (addr && !seen.has(addr) && pair.chainId === "solana") {
                            seen.add(addr);
                            allPairs.push(pair);
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.log(`⚠️ Error en profiles: ${e.message}`);
    }

    return allPairs;
}

export async function scanMarket() {
    try {
        console.log("🔍 Patrullando: Rebirth + AI + Second Leg...");

        const allPairs = await collectPairs();
        if (allPairs.length === 0) return [];

        console.log(`📋 ${allPairs.length} pares únicos de Solana para analizar`);

        const tokens = [];

        for (const pair of allPairs) {
            const sym = pair.baseToken?.symbol || "UNK";
            const name = pair.baseToken?.name || "";
            const addr = pair.baseToken?.address;

            if (GIANTS.includes(sym.toUpperCase())) continue;

            const liq = pair.liquidity?.usd || 0;
            const vol5m = pair.volume?.m5 || 0;
            const vol1h = pair.volume?.h1 || 0;
            const mcap = pair.fdv || 0;

            const priceChange1h = pair.priceChange?.h1 || 0;
            const priceChange24h = pair.priceChange?.h24 || 0;

            // Pre-filtros rápidos
            if (liq < MIN_LIQUIDITY) continue;
            if (mcap < MIN_MCAP) continue;
            if (vol5m < 1000) continue;

            // --- NARRATIVA IA ---
            const fullText = (name + " " + sym).toUpperCase();
            const isAIAgent = AI_KEYWORDS.some(word => fullText.includes(word));

            // --- PATRONES ---
            const earlyPump = priceChange1h > 15;

            const hadPump = priceChange24h > 50 || priceChange1h > 20;
            const isDip = priceChange1h < 0 && priceChange24h > 20;
            const reactivation = vol5m > (vol1h / 12) * 2;
            const secondLeg = hadPump && isDip && reactivation;

            const volumeSpike = vol5m > (vol1h / 12) * 3;

            const hasSignal = earlyPump || secondLeg || volumeSpike;
            if (!hasSignal) continue;

            // --- RUGCHECK ---
            const rugScore = await getRugScore(addr);

            if (rugScore === null) continue; // Sin datos = descartamos

            if (rugScore < MAX_RUGCHECK) {
                const buys = pair.txns?.m5?.buys || 1;
                const sells = pair.txns?.m5?.sells || 1;

                tokens.push({
                    token: sym,
                    address: addr,
                    price: Number(pair.priceUsd),
                    liquidity: liq,
                    mcap,
                    v5m: vol5m,
                    ratio: buys / sells,
                    momentum: true,
                    trigger: isAIAgent ? "🤖 AI AGENT" : "🌟 MARKET",
                    rugcheckScore: rugScore,
                    earlyPump,
                    secondLeg,
                    volumeSpike
                });

                console.log(`🔥 ${sym} | MCAP:$${(mcap/1000).toFixed(0)}k | Liq:$${Math.round(liq)} | Pump:${earlyPump} | 2ndLeg:${secondLeg} | VolSpike:${volumeSpike}`);

            } else {
                if (!mutedScams.has(addr)) {
                    console.log(`🚫 ${sym} descartado (${rugScore})`);
                    mutedScams.add(addr);
                }
            }
        }

        console.log(`✅ ${tokens.length} candidatos`);
        return tokens;

    } catch (err) {
        console.log("❌ Scanner error:", err.message);
        return [];
    }
}
