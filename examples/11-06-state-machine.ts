/**
 * 11-06 状态模式 —— 用状态机替代布尔标志位组合
 *
 * 设计决策:
 * 1. 状态用可辨识联合(Discriminated Union)建模:互斥、编译期穷尽检查;
 * 2. 转移函数 transition(state, event) 是纯函数 —— 同输入永远同输出,可独立单测;
 * 3. 非法转移(loading 中再次 FETCH)返回原状态 —— 天然防重复提交,无需额外布尔锁;
 * 4. 视图层依据状态渲染,不再出现 loading && !error && hasMore 式的组合判断。
 *
 * 坑点:
 * - 布尔标志位组合的状态空间是 2^n,其中大半是非法态,这才是 bug 温床;
 * - 生产中复杂交互流推荐 XState(可视化转移图 + actor 模型),本例是其最小核心。
 */

// ❌ 反例:三个布尔值有 2^3 = 8 种组合,其中一半是非法态(loading && error 同时为 true?)
// let loading = false; let error = false; let hasMore = true;

// ✅ 正例:互斥状态 + 显式转移表
type LoadState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'success'; hasMore: boolean }
    | { status: 'error'; retryable: true };

type LoadEvent =
    | { type: 'FETCH' }
    | { type: 'RESOLVE'; hasMore: boolean }
    | { type: 'REJECT' }
    | { type: 'RESET' };

function transition(state: LoadState, event: LoadEvent): LoadState {
    switch (event.type) {
        case 'FETCH':
            return state.status === 'loading' ? state : { status: 'loading' }; // loading 中忽略重复 FETCH(防重复请求)
        case 'RESOLVE':
            return state.status === 'loading' ? { status: 'success', hasMore: event.hasMore } : state;
        case 'REJECT':
            return state.status === 'loading' ? { status: 'error', retryable: true } : state;
        case 'RESET':
            return { status: 'idle' };
    }
}

let state: LoadState = { status: 'idle' };
const send = (e: LoadEvent) => {
    state = transition(state, e);
    console.log(state);
};

send({ type: 'FETCH' }); // { status: 'loading' }
send({ type: 'FETCH' }); // 忽略:仍是 loading(天然防重复提交)
send({ type: 'RESOLVE', hasMore: true }); // { status: 'success', hasMore: true }
send({ type: 'FETCH' });
send({ type: 'REJECT' }); // { status: 'error', retryable: true }
send({ type: 'FETCH' }); // error 态允许重试

// ---- 视图层依据状态渲染,不再出现组合判断 ----
function render(s: LoadState) {
    switch (s.status) {
        case 'idle':
            return '点击加载';
        case 'loading':
            return '加载中...';
        case 'success':
            return s.hasMore ? '加载更多' : '没有更多了';
        case 'error':
            return '加载失败,点击重试';
    }
}
console.log(render(state));

export {};
