// 文件: examples/01-03-closure-wallet.ts
// ============ 示例 1:闭包实现数据私有化 ============

function createWallet(initialBalance: number) {
    // balance 被下面的方法"封闭"起来,外部无法直接读写
    let balance = initialBalance;

    return {
        deposit(amount: number): number {
            if (amount <= 0) throw new Error('金额必须大于 0');
            balance += amount; // 闭包捕获的是 balance 这个变量的引用
            return balance;
        },
        withdraw(amount: number): number {
            if (amount > balance) throw new Error('余额不足');
            balance -= amount;
            return balance;
        },
        getBalance(): number {
            return balance;
        },
    };
}

const wallet = createWallet(100);
wallet.deposit(50);
console.log(wallet.getBalance()); // 150
console.log((wallet as any).balance); // undefined —— 外部拿不到 balance
