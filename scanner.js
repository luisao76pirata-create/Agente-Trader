import axios from "axios";

// --- ENDPOINTS ---
const PROFILES_API = "https://api.dexscreener.com/token-profiles/latest/v1";
const PAIRS_API = "https://api.dexscreener.com/latest/dex/tokens/";
const RUGCHECK_API = "https://api.rugcheck.xyz/v1/tokens/";

// --- CONFIG ---
const AI_KEYWORDS = ["AI", "AGENT", "BOT", "NEURAL", "AUTONOMOUS", "MIND", "VIRTUAL", "SENTIENT", "ELIZA", "GOV"];
let mutedScams = new Set();

async function getRugScore(address) {
    try {
        const res = await axios.get(`${RUGCHECK_API}${address}/report`, { timeout: 5000 });
        return res.data?.score ?? null;
    } catch {
        return null;
    }
}

export async function scanMarket() {
    try {
        console.log("🔍 Patrullando: Rebirth + AI + Second Leg...");

        const profileRes = await axios.get(PROFILES_API);
        if (!Array.isArray(profileRes.data)) return [];

        const solanaProfiles = profileRes.data
            .filter(t => t.chainId === 'solana')
            .slice(0, 30);

        if (solanaProfiles.length === 0) return [];

        const addresses = solanaProfiles.map(t => t.tokenAddress).join(',');
        const pairsRes = await axios.get(`${PAIRS_API}${addresses}`);

        if (!pairsRes.data?.pairs) return [];

        const tokens = [];

        for (const pair of pairsRes.data.pairs) {
            const sym = pair.baseToken?.symbol || "UNK";
            const name = pair.baseToken?.name || "";
            const addr = pair.baseToken?.address;

            const giants = ["SOL","USDC","USDT","RAY","BONK","JUP","PYTH","WIF"];
            if (giants.includes(sym.toUpperCase())) continue;

            const liq = pair.liquidity?.usd || 0;
            const vol5m = pair.volume?.m5 || 0;
            const vol1h = pair.volume?.h1 || 0;

            const priceNow = Number(pair.priceUsd);
            const price1h = pair.priceChange?.h1 || 0;
            const price24h = pair.priceChange?.h24 || 0;

            // --- IA NARRATIVE ---
            const fullText = (name + " " + sym).toUpperCase();
            const isAIAgent = AI_KEYWORDS.some(word => fullText.includes(word));

            // --- PATRONES ---
            const earlyPump = price1h > 15;

            const hadPump = price24h > 50 || price1h > 20;
            const isDip = price1h < 0 && price24h > 20;
            const reactivation = vol5m > (vol1h / 12) * 2;

            const secondLeg = hadPump && isDip && reactivation;
            const volumeSpike = vol5m > (vol1h / 12) * 3;

            // --- FILTROS ---
            const minLiq = isAIAgent ? 6000 : 8000;

            if (liq < minLiq) continue;

            const hasSignal = earlyPump || secondLeg || volumeSpike;
            if (!hasSignal) continue;

            // --- RUGCHECK ---
            const rugScore = await getRugScore(addr);

            if (rugScore !== null && rugScore < 200) {
                const buys = pair.txns?.m5?.buys || 1;
                const sells = pair.txns?.m5?.sells || 1;

                tokens.push({
                    token: sym,
                    address: addr,
                    price: priceNow,
                    liquidity: liq,
                    mcap: pair.fdv || 0,
                    v5m: vol5m,
                    ratio: buys / sells,
                    momentum: true,
                    trigger: isAIAgent ? "🤖 AI AGENT" : "🌟 MARKET",
                    rugcheckScore: rugScore,

                    // 🧠 NUEVO
                    earlyPump,
                    secondLeg,
                    volumeSpike
                });

                console.log(
                    `🔥 ${sym} | Pump:${earlyPump} | 2ndLeg:${secondLeg} | VolSpike:${volumeSpike}`
                );

            } else if (rugScore >= 200) {
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
