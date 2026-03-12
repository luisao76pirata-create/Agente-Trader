import axios from "axios";

// Configuración de tus filtros Pro
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

// Función para auditar el token en RugCheck
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

// Filtro rápido de DexScreener
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

export async function scanMarket() {
  try {
    console.log("🔍 Escaneando DexScreener con filtros Pro...");
    const url = "https://api.dexscreener.com/latest/dex/search?q=solana";
    const response = await axios.get(url, { timeout: 8000 });
    
    const allPairs = response.data.pairs || [];
    if (allPairs.length === 0) return [];

    // Paso 1: Filtro rápido de métricas
    const candidates = allPairs.filter(p => p.chainId === "solana").filter(preFilter);
    console.log(`📊 ${candidates.length} candidatos pasaron el pre-filtro.`);

    if (candidates.length === 0) return [];

    // Paso 2: RugCheck (solo a los 5 mejores por volumen para evitar bloqueos)
    const topCandidates = candidates
      .sort((a, b) => (b.volume?.m5 || 0) - (a.volume?.m5 || 0))
      .slice(0, 5);

    const results = [];

    for (const pair of topCandidates) {
      const address = pair.baseToken?.address;
      if (!address) continue;

      console.log(`🛡️ Auditando ${pair.baseToken?.symbol} en RugCheck...`);
      const rug = await checkRugCheck(address);

      // Filtros de seguridad críticos
      if (!rug) continue;
      if (rug.mintAuthority || rug.freezeAuthority || !rug.lpLocked || rug.top10 > FILTERS.maxTop10Holdings || rug.score < 500) {
        console.log(`🚫 ${pair.baseToken?.symbol} descartado por seguridad (RugCheck).`);
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
        rugcheckScore: rug.score
      });

      console.log(`✅ ${pair.baseToken?.symbol} ha pasado todas las pruebas.`);
      // Pequeña pausa para no saturar la API de RugCheck
      await new Promise(r => setTimeout(r, 800));
    }

    return results;
  } catch (e) {
    console.error("❌ Error en el Scanner:", e.message);
    return [];
  }
}
