// 文件: examples/02-01-narrowing.ts
// ============ 类型收窄:让编译器"理解"你的分支逻辑 ============

// ---- 判别联合:用字面量字段区分,消灭非法状态 ----
// ❌ 反例:布尔标志会出现"loading=true 且 data 有值"的非法状态
// interface BadState { loading: boolean; data?: User[]; error?: Error }

// ✅ 正例:每个状态互斥,访问 data 前编译器强制你先收窄
type FetchState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'success'; data: string[] }
    | { status: 'error'; error: Error };

function render(state: FetchState): string {
    switch (state.status) {
        case 'idle':
            return '空';
        case 'loading':
            return '加载中...';
        case 'success':
            return state.data.join(','); // ✅ 这里 state 已被收窄,能安全访问 data
        case 'error':
            return `出错了: ${state.error.message}`; // ✅ 同理,不需要 `!` 或 as
    }
}

// ---- unknown 与类型守卫:处理"不可信输入"的正确姿势 ----
function parseUser(json: string) {
    const raw: unknown = JSON.parse(json); // JSON.parse 返回 any,立刻收窄为 unknown
    if (isUser(raw)) {
        return raw; // ✅ raw 在这里是 { id: string; name: string }
    }
    throw new Error('非法的用户数据');
}

// 类型谓词函数:x is User —— 告诉编译器"返回 true 时 x 就是 User"
function isUser(x: unknown): x is { id: string; name: string } {
    return (
        typeof x === 'object' &&
        x !== null &&
        'id' in x &&
        'name' in x &&
        typeof (x as { id: unknown }).id === 'string' &&
        typeof (x as { name: unknown }).name === 'string'
    );
}

console.log(render({ status: 'success', data: ['a', 'b'] }));
console.log(parseUser('{"id":"1","name":"Alice"}').name); // Alice

// ---- 可辨识失败结果:Result 模式,让错误必须被处理 ----
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function safeDivide(a: number, b: number): Result<number> {
    if (b === 0) return { ok: false, error: '除数不能为 0' };
    return { ok: true, value: a / b };
}

const result = safeDivide(10, 2);
if (result.ok) console.log(result.value); // 5 —— 不检查 ok 就拿不到 value
