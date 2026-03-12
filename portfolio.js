export class Portfolio {

    constructor() {

        this.balance = 10000
        this.positions = []

    }

    openPosition(token, price, size) {

        const cost = price * size

        if (cost > this.balance) {

            console.log("❌ Not enough balance")
            return

        }

        this.balance -= cost

        this.positions.push({
            token,
            price,
            size
        })

        console.log("📈 Position opened:", token)

    }

}
