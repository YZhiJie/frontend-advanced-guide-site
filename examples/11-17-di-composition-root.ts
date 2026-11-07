/**
 * 11-17 依赖注入与组合根 —— 全应用唯一"知道具体实现"的地方
 *
 * 设计决策:
 * 1. CheckoutService 构造函数只接收抽象接口(PaymentGateway/Logger),业务逻辑零实现细节;
 * 2. 组合根(main.ts)负责把具体实现组装起来 —— 这是全应用唯一 import 具体 SDK 的位置;
 * 3. 测试时两行 mock 替换依赖,业务代码零改动 —— 这就是依赖倒置的直接回报。
 *
 * 坑点:
 * - 前端不需要 IoC 容器,"组合根 + 构造函数注入"覆盖 95% 场景;
 * - React 的 Context / Vue 的 provide-inject 本质是它的框架化版本,注意不要用成"到处可取"的
 *   全局单例,依赖仍应从入口单向传递。
 */

interface PaymentGateway {
    pay(cents: number, orderId: string): Promise<{ transactionId: string }>;
}
interface Logger {
    info(msg: string): void;
}

/** 业务服务:只依赖抽象参数,完全不知道支付渠道/日志实现 */
class CheckoutService {
    constructor(
        private gateway: PaymentGateway,
        private logger: Logger,
    ) {}
    async submit(cents: number, orderId: string) {
        const r = await this.gateway.pay(cents, orderId);
        this.logger.info(`订单 ${orderId} 支付成功 ${r.transactionId}`);
        return r;
    }
}

// ---- 生产环境组合根(main.ts)----
const logger: Logger = { info: (m) => console.log('[INFO]', m) }; // 可换上报版
const gateway: PaymentGateway = { pay: (c, o) => Promise.resolve({ transactionId: `wx_${o}_${c}` }) }; // 可换渠道
const checkout = new CheckoutService(gateway, logger);

// ---- 测试环境:两行 mock,业务代码零改动(这就是倒置的回报)----
const fakeGateway: PaymentGateway = { pay: () => Promise.resolve({ transactionId: 'TEST_001' }) };
const testCheckout = new CheckoutService(fakeGateway, { info: () => {} });

await checkout.submit(9900, 'A_001');
await testCheckout.submit(9900, 'A_001');
console.log('✅ 同一份业务代码,两套依赖注入完成生产/测试切换');

export {};
