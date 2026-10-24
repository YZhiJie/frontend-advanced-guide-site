// 文件: examples/01-18-fp-basics.ts
// ============ 纯函数与不可变性 ============

// ❌ 非纯函数:修改了外部状态(副作用),同样的调用结果却不同
let count = 0;
function impureIncrement() {
    count++;
    return count;
}

// ✅ 纯函数:不碰外部状态,输入定输出
const pureIncrement = (n: number) => n + 1;

// ---- 不可变更新:永远返回新对象/新数组,不修改原值 ----
interface Todo { id: number; title: string; done: boolean }

const todos: Todo[] = [{ id: 1, title: '学习闭包', done: false }];

// ❌ 突变式更新(react-redux 时代会直接导致组件不更新)
// todos.push({ id: 2, title: '学习FP', done: false });

// ✅ 不可变更新:展开运算符 + map
const addTodo = (list: Todo[], title: string): Todo[] => [...list, { id: list.length + 1, title, done: false }];
const toggleTodo = (list: Todo[], id: number): Todo[] =>
    list.map((t) => (t.id === id ? { ...t, done: !t.done } : t));

const next = toggleTodo(addTodo(todos, '学习FP'), 1);
console.log(todos);     // 原数组未被修改
console.log(next);      // [{done:true}, {id:2,...}]

// ---- 对象的不可变更新 ----
const state = { user: { name: 'Alice', tags: ['a'] }, page: 1 };
const newState = {
    ...state,                                        // 浅拷贝第一层
    user: { ...state.user, tags: [...state.user.tags, 'b'] }, // 深层要逐层展开
    page: 2,
};
// 💡 提示:深层嵌套更新很繁琐,生产中用 Immer:`produce(state, draft => { draft.page = 2 })`

console.log(JSON.stringify(newState.user.tags)); // ['a','b']
