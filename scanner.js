import axios from "axios";

const FILTERS = {
  minLiquidity: 20000,
  minVolume5m: 5000,
  minMcap: 50000,
  maxMcap: 10000000,
  minBuyRatio: 1.5,
  minUniqueBuyers: 10,
  minPriceChange5m: 3,
  maxTop10Holdings: 20,
};

const DEXSCREENER_ENDPOINTS = [
  "https://api.dexscreener.com/token-boosts/top/v1",
  "https://api.dexscreener.com/token-boosts/latest/v1",
];

async function checkRugCheck(tokenAddress) {
  try {
    const url = `https://api.rugcheck.xyz/v1/tokens/${tokenAddress}/report/summary`;
    const res = await axios.get(url, { timeout: 5000 });
    const data = res.data;
    return {
      score: data.score || 0,
      mintAuthority: data.mintAuthority !== null && data.mintAuthority !== false,
      freezeAuthority: data.freezeAuthority !== null && data.freezeAuthority !== false,
      lpLocked: data.markets?.[0]?.lp?.lpLockedPct > 80,
      top10: data.topHolders?.reduce((acc, h) => acc + (h.pct || 0), 0) || 100,
      risks: data.risks?.map(r => r.name) || [],
    };
  } catch (e) {
    console.log(`⚠️ RugCheck no disponible para ${tokenAddress}`);
    return null;
  }
}

function preFilter(pair) {
  const liquidity = pair.liquidity?.usd || 0;
  const volume5m = pair.volume?.m5 || 0;
  const mcap = pair.fdv || 0;
  const buys = pair.txns?.m5?.buys || 0;
  const sells = pair.txns?.m5?.sells || 1;
  const priceChange5m = pair.priceChange?.m5 || 0;
  const buyRatio = buys / sells;
  return (
    liquidity >= FILTERS.minLiquidity &&
    volume5m >= FILTERS.minVolume5m &&
    mcap >= FILTERS.minMcap &&
    mcap <= FILTERS.maxMcap &&
    buyRatio >= FILTERS.minBuyRatio &&
    buys >= FILTERS.minUniqueBuyers &&
    priceChange5m >= FILTERS.minPriceChange5m
  );
}

async function getPairsForTokens(addresses) {
  try {
    const chunk = addresses.slice(0, 30).join(",");
    const url = `https://api.dexscreener.com/latest/dex/tokens/${chunk}`;
    const res = await axios.get(url, { timeout: 8000 });
    return (res.data.pairs || []).filter(p => p.chainId === "solana");
  } catch (e) {
    console.log("⚠️ Error obteniendo pares:", e.message);
    return [];
  }
}

export async function scanMarket() {
  try {
    console.log("🔍 Escaneando DexScreener con filtros Pro...");

    let tokenAddresses = [];

    for (const endpoint of DEXSCREENER_ENDPOINTS) {
      try {
        const res = await axios.get(endpoint, { timeout: 8000 });
        const items = Array.isArray(res.data) ? res.data : [];
        const solanaTokens = items
          .filter(t => t.chainId === "solana")
          .map(t => t.tokenAddress)
          .filter(Boolean);
        tokenAddresses = [...new Set([...tokenAddresses, ...solanaTokens])];
        console.log(`📡 ${endpoint.split("/").pop()}: ${solanaTokens.length} tokens encontrados`);
      } catch (e) {
        console.log(`⚠️ Error en endpoint ${endpoint}: ${e.message}`);
      }
    }

    if (tokenAddresses.length === 0) {
      console.log("⚠️ No se encontraron tokens en DexScreener");
      return [];
    }

    console.log(`📋 Total tokens únicos a analizar: ${tokenAddresses.length}`);

    const allPairs = await getPairsForTokens(tokenAddresses);
    console.log(`📊 ${allPairs.length} pares obtenidos de DexScreener`);

    if (allPairs.length === 0) return [];

    const candidates = allPairs.filter(preFilter);
    console.log(`✅ ${candidates.length} candidatos pasaron el pre-filtro`);

    if (candidates.length === 0) {
      const sample = allPairs.slice(0, 3);
      sample.forEach(p => {
        console.log(`🔎 ${p.baseToken?.symbol}: liq=$${p.liquidity?.usd || 0} vol5m=$${p.volume?.m5 || 0} mcap=$${p.fdv || 0} buys=${p.txns?.m5?.buys || 0} change=${p.priceChange?.m5 || 0}%`);
      });
      return [];
    }

    const topCandidates = candidates
      .sort((a, b) => (b.volume?.m5 || 0) - (a.volume?.m5 || 0))
      .slice(0, 5);

    const results = [];

    for (const pair of topCandidates) {
      const address = pair.baseToken?.address;
      if (!address) continue;

      console.log(`🛡️ Auditando ${pair.baseToken?.symbol} en RugCheck...`);
      const rug = await checkRugCheck(address);

      if (!rug) continue;

      if (rug.mintAuthority || rug.freezeAuthority || !rug.lpLocked ||
          rug.top10 > FILTERS.maxTop10Holdings || rug.score < 500) {
        console.log(`🚫 ${pair.baseToken?.symbol} descartado (score=${rug.score}, top10=${rug.top10.toFixed(1)}%, lpLocked=${rug.lpLocked})`);
        continue;
      }

      results.push({
        token: pair.baseToken?.symbol,
        address,
        price: parseFloat(pair.priceUsd) || 0,
        mcap: pair.fdv || 0,
        liquidity: pair.liquidity?.usd || 0,
        ratio: (pair.txns?.m5?.buys || 1) / (pair.txns?.m5?.sells || 1),
        v5m: pair.volume?.m5 || 0,
        momentum: true,
        url: pair.url,
        rugcheckScore: rug.score,
      });

      console.log(`✅ ${pair.baseToken?.symbol} ha pasado todas las pruebas.`);
      await new Promise(r => setTimeout(r, 800));
    }

    return results;

  } catch (e) {
    console.error("❌ Error en el Scanner:", e.message);
    return [];
  }
}
