/**
 * 11-05 命令模式 —— 撤销/重做双栈
 *
 * 设计决策:
 * 1. 命令定义为 { do, undo, label }:do/undo 严格互逆,label 便于调试与"撤销了 XX"提示;
 * 2. 历史用 past/future 双栈 —— undo 把命令从 past 弹出推进 future,redo 反向;
 * 3. execute 新命令时清空 future 栈 —— 分叉后旧的"未来"作废,这是 undo/redo 最常见 bug;
 * 4. 示例用不可变快照实现命令(适合中小状态);大状态如图像像素应记录逆操作参数(diff 型)。
 *
 * 坑点:
 * - undo/redo 到头必须静默返回而非抛错,否则 UI 边界点击直接白屏;
 * - 撤销/重做按钮的可用态应从栈长度派生(canUndo = past.length > 0),不要用额外的布尔标志位。
 */

/** 命令抽象:do 与 undo 必须严格互逆 */
interface Command<T> {
    do(state: T): T;
    undo(state: T): T;
    label: string;
}

class History<T> {
    private past: Command<T>[] = [];
    private future: Command<T>[] = []; // redo 栈

    constructor(private state: T) {}

    /** 执行命令:清空 redo 栈(分叉后旧未来作废) */
    execute(cmd: Command<T>): T {
        this.state = cmd.do(this.state);
        this.past.push(cmd);
        this.future = []; // ⚠️ 忘记清空 redo 栈是 undo/redo 最常见的 bug
        return this.state;
    }

    undo(): T {
        const cmd = this.past.pop();
        if (!cmd) return this.state; // 到头静默返回,不抛错
        this.state = cmd.undo(this.state);
        this.future.unshift(cmd);
        return this.state;
    }

    redo(): T {
        const cmd = this.future.shift();
        if (!cmd) return this.state;
        this.state = cmd.do(this.state);
        this.past.push(cmd);
        return this.state;
    }

    get current() {
        return this.state;
    }
    // ✅ UI 按钮态从栈派生,不要用额外的布尔标志位
    get canUndo() {
        return this.past.length > 0;
    }
    get canRedo() {
        return this.future.length > 0;
    }
}

// ---- 用不可变快照实现命令(比 diff 逆运算简单可靠,适合中小状态)----
type Doc = { lines: string[] };

const addLine = (text: string): Command<Doc> => ({
    label: `添加行:${text}`,
    do: (s) => ({ lines: [...s.lines, text] }), // 不可变追加
    undo: (s) => ({ lines: s.lines.slice(0, -1) }), // 逆操作:去掉最后一行
});

const history = new History<Doc>({ lines: [] });
history.execute(addLine('第一行'));
history.execute(addLine('第二行'));
console.log(history.current.lines); // ['第一行', '第二行']
console.log(history.undo().lines); // ['第一行']
console.log(history.undo().lines); // []
console.log(history.redo().lines); // ['第一行']
console.log('canUndo:', history.canUndo, 'canRedo:', history.canRedo);

// ---- ⚠️ 大状态(如图像像素)快照太贵:改为记录"逆操作参数"(位置+旧值),即 diff 型命令 ----
export {};
