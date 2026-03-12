export function simulateTrade(trade) {

    const record = {
        ...trade,
        simulated: true,
        timestamp: Date.now()
    }

    console.log("📊 SIM TRADE:", record)

}
