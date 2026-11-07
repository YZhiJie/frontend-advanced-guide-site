/**
 * 11-07 适配器模式 —— 多渠道支付统一封装
 *
 * 设计决策:
 * 1. 业务侧只依赖 PaymentGateway 抽象(依赖倒置),渠道实现在组合根注入(见 11-17);
 * 2. 每个适配器集中处理"差异":单位换算(分→元)、参数映射、回调→Promise;
 * 3. 新增渠道 = 新增一个适配器对象 + 注册表加一行,业务 checkout 函数零改动(开闭原则)。
 *
 * 坑点:
 * - 适配器里的错误必须归一化:各渠道的错误码/错误结构不同,应在适配层转成统一业务错误;
 * - 金额等敏感字段在适配层做断言(整数分),防止上游单位混乱导致资损。
 */

/** 业务侧依赖的稳定抽象(依赖倒置,见 11.4) */
interface PaymentGateway {
    pay(amountCents: number, orderId: string): Promise<{ transactionId: string }>;
}

// ---- 渠道 1:支付宝 SDK(假设回调风格、金额单位是元)----
const alipaySDK = {
    createOrder(yuan: number, subject: string): Promise<string> {
        return Promise.resolve(`alipay_${subject}_${yuan}`);
    },
};

const alipayAdapter: PaymentGateway = {
    async pay(amountCents, orderId) {
        if (!Number.isInteger(amountCents)) throw new Error('金额必须为整数分'); // 适配层兜底校验
        // 适配点:分 → 元、参数名映射
        const id = await alipaySDK.createOrder(amountCents / 100, orderId);
        return { transactionId: id };
    },
};

// ---- 渠道 2:微信 SDK(参数是对象、回调风格)----
const wechatSDK = {
    unifiedorder(
        params: { total_fee: number; out_trade_no: string },
        cb: (err: Error | null, tradeNo?: string) => void,
    ) {
        cb(null, `wx_${params.out_trade_no}`);
    },
};

const wechatAdapter: PaymentGateway = {
    pay(amountCents, orderId) {
        return new Promise((resolve, reject) => {
            // 适配点:回调 → Promise、字段重命名
            wechatSDK.unifiedorder({ total_fee: amountCents, out_trade_no: orderId }, (err, tradeNo) => {
                err ? reject(err) : resolve({ transactionId: tradeNo! });
            });
        });
    },
};

// ---- 业务侧只认抽象,渠道切换是配置问题 ----
const gateways: Record<'alipay' | 'wechat', PaymentGateway> = { alipay: alipayAdapter, wechat: wechatAdapter };

async function checkout(channel: keyof typeof gateways, amountCents: number, orderId: string) {
    const result = await gateways[channel].pay(amountCents, orderId); // 业务代码零渠道知识
    console.log(`[${channel}] 支付成功`, result.transactionId);
}

await checkout('alipay', 9900, 'A_001');
await checkout('wechat', 9900, 'A_001');

export {};
