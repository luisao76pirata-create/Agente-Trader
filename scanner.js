import fetch from "node-fetch";

export async function scanMarket() {

    try {

        const res = await fetch(
            "https://api.dexscreener.com/latest/dex/pairs/solana"
        );

        const data = await res.json();

        const tokens = data.pairs.slice(0, 40).map(pair => {

            return {
                token: pair.baseToken.symbol,
                address: pair.baseToken.address,

                price: parseFloat(pair.priceUsd) || 0,

                mcap: pair.fdv || 0,

                liquidity: pair.liquidity?.usd || 0,

                ratio:
                    pair.txns?.m5?.buys && pair.txns?.m5?.sells
                        ? pair.txns.m5.buys / pair.txns.m5.sells
                        : 1,

                v5m: pair.volume?.m5 || 0,

                momentum: (pair.priceChange?.m5 || 0) > 5,

                uniqueBuyers5m: pair.txns?.m5?.buys || 0,

                mintAuthority: false,
                freezeAuthority: false,
                lpLocked: true,

                top10: 30
            };

        });

        return tokens;

    } catch (e) {

        console.log("Scanner error", e);
        return [];

    }

}
