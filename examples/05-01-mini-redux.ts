// 文件: examples/05-01-mini-redux.ts
// ============ 手写 30 行 Redux:理解"可预测状态容器"============

type Action = { type: string; payload?: unknown };
type Reducer<S> = (state: S, action: Action) => S;

function createStore<S>(reducer: Reducer<S>, preloadedState?: S) {
    let state = preloadedState as S;
    const listeners = new Set<() => void>();

    return {
        getState: () => state,
        dispatch(action: Action) {
            state = reducer(state, action); // ① 纯函数计算新状态
            listeners.forEach((l) => l());  // ② 通知所有订阅者
            return action;
        },
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener); // 返回取消订阅
        },
    };
}

// ---- 使用:计数器 ----
type CounterState = { value: number };
const initialState: CounterState = { value: 0 };

function counterReducer(state: CounterState = initialState, action: Action): CounterState {
    switch (action.type) {
        case 'increment':
            return { ...state, value: state.value + 1 }; // 不可变更新,纯函数
        case 'add':
            return { ...state, value: state.value + (action.payload as number) };
        default:
            return state; // 未知 action 返回原状态
    }
}

const store = createStore(counterReducer);
const unsubscribe = store.subscribe(() => console.log('状态变化:', store.getState()));

store.dispatch({ type: 'increment' });       // { value: 1 }
store.dispatch({ type: 'add', payload: 10 }); // { value: 11 }
unsubscribe();
store.dispatch({ type: 'increment' });        // 不再打印,但状态仍在变化
console.log('最终:', store.getState());
