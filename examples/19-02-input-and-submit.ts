// 文件: examples/19-02-input-and-submit.ts
// ============ 输入格式化 + 提交防重锁 + 验证码倒计时 ============
// 三类最高频的"交互手感"片段,全部是纯逻辑,在 input/click 事件里包一层即可。

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------- 输入格式化:只在"值"层面处理,不碰光标 ----------------

/** 只保留数字 */
export function digitsOnly(raw: string): string {
    return raw.replace(/\D/g, '');
}

/** 手机号 3-4-4 分组:138 0013 8000(最多 11 位) */
export function formatPhone(raw: string): string {
    const d = digitsOnly(raw).slice(0, 11);
    return [d.slice(0, 3), d.slice(3, 7), d.slice(7, 11)].filter(Boolean).join(' ');
}

/** 银行卡号每 4 位一组(卡号最长 19 位) */
export function formatBankCard(raw: string): string {
    return digitsOnly(raw).slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');
}

/**
 * 金额输入框实时清洗:
 * - 只允许数字与一个小数点; - 小数最多 2 位; - 不允许多余前导零; - "."开头补 "0."
 * 提交时再 Number(value),展示与存储分离。
 */
export function formatAmountInput(raw: string): string {
    let v = raw.replace(/[^\d.]/g, '');
    const firstDot = v.indexOf('.');
    if (firstDot !== -1) {
        // 只保留第一个小数点,其后的点全部剔除
        v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
    }
    v = v.replace(/^(\d*\.\d{2}).*$/, '$1'); // 截断两位小数之后的内容
    if (v.startsWith('.')) v = '0' + v;
    if (v.length > 1 && v.startsWith('0') && v[1] !== '.') v = v.replace(/^0+/, '');
    return v;
}

// ---------------- 提交防重锁(下单/支付/保存按钮通用) ----------------

/**
 * 把一个异步任务包成"同一时刻只允许一个在途"的函数。
 * 锁在 finally 里释放:业务抛错也不会把按钮永久锁死。
 * 返回 undefined 表示本次调用被忽略(可用于埋点重复点击)。
 */
export function withSubmitLock<T>(task: () => Promise<T>): () => Promise<T | undefined> {
    let locked = false;
    return async () => {
        if (locked) {
            console.warn('[lock] 正在提交中,重复点击已忽略');
            return undefined;
        }
        locked = true;
        try {
            return await task();
        } finally {
            locked = false;
        }
    };
}

// ---------------- 验证码倒计时 ----------------

/**
 * 秒级倒计时,onTick 每秒回调剩余秒数,onDone 结束时回调。
 * 返回 cancel():组件卸载 / 重新发送时必须调用,否则定时器泄漏(见 1.6 内存泄漏)。
 */
export function countdown(
    seconds: number,
    onTick: (left: number) => void,
    onDone?: () => void,
): () => void {
    let left = seconds;
    onTick(left);
    const timer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
            clearInterval(timer);
            onTick(0);
            onDone?.();
        } else {
            onTick(left);
        }
    }, 1000);
    return () => clearInterval(timer);
}

// ---------------- 验证 ----------------

// ---- 格式化 ----
console.log(formatPhone('abc1380013800099')); // '138 0013 8000'
console.log(formatBankCard('6222021234567890123')); // '6222 0212 3456 7890 123'
console.log(formatAmountInput('0012.345abc')); // '12.34'
console.log(formatAmountInput('.5')); // '0.5'
console.log(formatAmountInput('100')); // '100'

// ---- 防重锁:连续点击 3 次,任务只执行 1 次 ----
let runs = 0;
const submitOrder = withSubmitLock(async () => {
    runs += 1;
    await sleep(50); // 模拟接口耗时
    return '下单成功';
});
const results = await Promise.all([submitOrder(), submitOrder(), submitOrder()]);
console.log('任务执行次数 =', runs); // 1
console.log('返回值 =', results); // ['下单成功', undefined, undefined]

// ---- 倒计时:3 秒,观察每秒回调与结束回调(真实使用一般是 60 秒) ----
await new Promise<void>((resolve) => {
    const ticks: number[] = [];
    countdown(3, (left) => ticks.push(left), () => {
        console.log('倒计时序列 =', ticks); // [3, 2, 1, 0]
        resolve();
    });
});
