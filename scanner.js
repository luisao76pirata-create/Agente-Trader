import fetch from "node-fetch";

const DEXSCREENER_URL = "https://api.dexscreener.com/latest/dex/pairs/solana";
const RUGCHECK_URL = "https://api.rugcheck.xyz/v1/tokens";

// Minimum thresholds to even consider a token
const FILTERS = {
  minLiquidity: 20000,      // $20k minimum liquidity
  minVolume5m: 5000,        // $5k volume in last 5 minutes
  minMcap: 50000,           // $50k minimum market cap
  maxMcap: 10000000,        // $10M max (avoid already pumped tokens)
  minBuyRatio: 1.5,         // 1.5x more buys than sells
  minUniqueBuyers: 10,      // At least 10 buy transactions in 5m
  minPriceChange5m: 3,      // At least 3% price increase in 5m
  maxTop10Holdings: 20,     // Top 10 wallets hold max 20% of supply (from RugCheck)
};

async function checkRugCheck(tokenAddress) {
  try {
    const res = await fetch(`${RUGCHECK_URL}/${tokenAddress}/report/summary`, {
      headers: { "Accept": "application/json" },
      timeout: 5000,
    });

    if (!res.ok) return null;

    const data = await res.json();

    return {
      score: data.score || 0,                          // Higher = safer
      mintAuthority: data.mintAuthority !== null,       // true = DANGER
      freezeAuthority: data.freezeAuthority !== null,   // true = DANGER
      lpLocked: data.markets?.[0]?.lp?.lpLockedPct > 80, // LP locked > 80%
      top10: data.topHolders?.reduce((acc, h) => acc + (h.pct || 0), 0) || 100,
      risks: data.risks?.map(r => r.name) || [],
    };
  } catch (e) {
    console.log(`RugCheck error for ${tokenAddress}:`, e.message);
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

export async function scanMarket() {
  try {
    console.log("🔍 Scanning DexScreener...");
    const res = await fetch(DEXSCREENER_URL, { timeout: 10000 });
    const data = await res.json();

    if (!data.pairs || data.pairs.length === 0) {
      console.log("⚠️ No pairs returned from DexScreener");
      return [];
    }

    // Step 1: Pre-filter with basic metrics (fast, no API calls)
    const candidates = data.pairs.filter(preFilter);
    console.log(`📊 ${candidates.length} candidates passed pre-filter out of ${data.pairs.length} pairs`);

    if (candidates.length === 0) return [];

    // Step 2: Run RugCheck on candidates (limit to top 10 by volume to avoid rate limits)
    const topCandidates = candidates
      .sort((a, b) => (b.volume?.m5 || 0) - (a.volume?.m5 || 0))
      .slice(0, 10);

    const results = [];

    for (const pair of topCandidates) {
      const address = pair.baseToken?.address;
      if (!address) continue;

      console.log(`🔎 Checking RugCheck for ${pair.baseToken?.symbol}...`);
      const rugcheck = await checkRugCheck(address);

      // If RugCheck fails, skip — better safe than sorry
      if (!rugcheck) {
        console.log(`⚠️ Skipping ${pair.baseToken?.symbol} — RugCheck unavailable`);
        continue;
      }

      // Hard safety filters from RugCheck
      if (rugcheck.mintAuthority) {
        console.log(`🚫 ${pair.baseToken?.symbol} — Mint authority active, SKIP`);
        continue;
      }
      if (rugcheck.freezeAuthority) {
        console.log(`🚫 ${pair.baseToken?.symbol} — Freeze authority active, SKIP`);
        continue;
      }
      if (!rugcheck.lpLocked) {
        console.log(`🚫 ${pair.baseToken?.symbol} — LP not locked, SKIP`);
        continue;
      }
      if (rugcheck.top10 > FILTERS.maxTop10Holdings) {
        console.log(`🚫 ${pair.baseToken?.symbol} — Top 10 hold ${rugcheck.top10.toFixed(1)}%, SKIP`);
        continue;
      }
      if (rugcheck.score < 500) {
        console.log(`🚫 ${pair.baseToken?.symbol} — RugCheck score too low (${rugcheck.score}), SKIP`);
        continue;
      }

      const buys = pair.txns?.m5?.buys || 0;
      const sells = pair.txns?.m5?.sells || 1;

      results.push({
        token: pair.baseToken?.symbol,
        address,
        price: parseFloat(pair.priceUsd) || 0,
        mcap: pair.fdv || 0,
        liquidity: pair.liquidity?.usd || 0,
        buyRatio: buys / sells,
        volume5m: pair.volume?.m5 || 0,
        volume1h: pair.volume?.h1 || 0,
        priceChange5m: pair.priceChange?.m5 || 0,
        priceChange1h: pair.priceChange?.h1 || 0,
        uniqueBuyers5m: buys,
        dexUrl: `https://dexscreener.com/solana/${address}`,
        // Real RugCheck data
        rugcheckScore: rugcheck.score,
        mintAuthority: rugcheck.mintAuthority,
        freezeAuthority: rugcheck.freezeAuthority,
        lpLocked: rugcheck.lpLocked,
        top10Holdings: rugcheck.top10,
        risks: rugcheck.risks,
      });

      console.log(`✅ ${pair.baseToken?.symbol} passed all filters`);

      // Small delay to avoid RugCheck rate limits
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`🏁 Scan complete: ${results.length} gems found`);
    return results;

  } catch (e) {
    console.error("❌ Scanner error:", e.message);
    return [];
  }
}
