import fetch from "node-fetch";

const DEX_API = "https://api.dexscreener.com/latest/dex/pairs/solana";
const RUGCHECK_API = "https://api.rugcheck.xyz/v1/tokens/";

let knownPools = new Set();

async function getRugScore(address) {

  try {

    const res = await fetch(`${RUGCHECK_API}${address}/report`);

    if (!res.ok) return null;

    const data = await res.json();

    return data.score ?? null;

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

  const momentum =
    volume5m > 4000 &&
    ratio > 1.2;

  const whaleSignal =
    volume5m > 20000 &&
    buys > sells * 1.5;

  const volumeSpike =
    volume1h > 0 &&
    volume5m > (volume1h / 12) * 3;

  return {
    volume5m,
    volume1h,
    ratio,
    momentum,
    whaleSignal,
    volumeSpike
  };

}

export async function scanMarket() {

  try {

    console.log("🔍 Escaneando DexScreener con filtros Pro...");

    const res = await fetch(DEX_API);
    const data = await res.json();

    if (!data.pairs) return [];

    const tokens = [];

    for (const pair of data.pairs) {

      if (!pair.baseToken || !pair.priceUsd) continue;

      const liquidity = pair.liquidity?.usd || 0;

      if (liquidity < 15000) continue;

      const analysis = analyzePair(pair);

      let momentum = analysis.momentum;

      // detectar pool nuevo
      if (!knownPools.has(pair.pairAddress)) {

        knownPools.add(pair.pairAddress);

        momentum = true;

        console.log("🆕 Nuevo pool:", pair.baseToken.symbol);

      }

      // detectar whale activity
      if (analysis.whaleSignal) {

        momentum = true;

        console.log("🐋 Whale activity:", pair.baseToken.symbol);

      }

      // detectar volume spike (tokens antiguos)
      if (analysis.volumeSpike) {

        momentum = true;

        console.log("📈 Volume spike:", pair.baseToken.symbol);

      }

      // Rugcheck
      const rugScore = await getRugScore(pair.baseToken.address);

      if (rugScore !== null && rugScore < 60) {

        console.log(`🚫 Rug filtrado ${pair.baseToken.symbol} (${rugScore})`);

        continue;

      }

      tokens.push({

        token: pair.baseToken.symbol,

        address: pair.baseToken.address,

        price: Number(pair.priceUsd),

        mcap: pair.fdv || 0,

        liquidity: liquidity,

        v5m: analysis.volume5m,

        ratio: analysis.ratio,

        momentum: momentum,

        whale: analysis.whaleSignal,

        volumeSpike: analysis.volumeSpike,

        rugcheckScore: rugScore

      });

    }

    tokens.sort((a, b) => b.v5m - a.v5m);

    console.log(`📊 ${tokens.length} candidatos pasaron el pre-filtro.`);

    return tokens.slice(0, 60);

  } catch (err) {

    console.log("Scanner error:", err.message);

    return [];

  }

}
