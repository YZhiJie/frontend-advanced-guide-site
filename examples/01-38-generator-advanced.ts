// 文件: examples/01-38-generator-advanced.ts
// ============ 生成器高阶模式:yield* 返回值 / 递归遍历剪枝 / throw 注入 / 双向通道 / 状态机 / 洋葱模型 ============
// 运行:npx tsx examples/01-38-generator-advanced.ts
// 设计决策:六个模式互相独立可单独摘用;洋葱模型刻意用同步生成器(历史 Koa 1 + co 的形态),
//          聚焦"yield* 委托 = 控制权进出"这个结构,异步版只是把驱动器换成 Promise(见 01-31 的 co)。
// 坑点提示:yield* 的返回值是内层生成器的 return 值,for...of 永远拿不到;首条 next 传参无效。

export {};

const log = (title: string) => console.log(`\n---- ${title} ----`);

// ============ 1. yield* 委托的返回值:内层生成器 return 的值 ============
log('1. yield* 表达式的值 = 被委托生成器的 return 值');

function* inner() {
    yield 1;
    yield 2;
    return 'inner 结束'; // return 值不会出现在 for...of/展开里,但会作为 yield* 的求值结果
}
function* outer() {
    const result: string = yield* inner(); // 先替 inner 吐出 1、2,结束后把 return 值交回
    yield `收到内部返回值:${result}`;
}
console.log([...outer()]); // [1, 2, '收到内部返回值:inner 结束']

// ============ 2. 递归树惰性遍历:yield* 递归 + break 剪枝 ============
log('2. 递归树遍历:找到即停,未搜索的分支零成本');

type Node = { name: string; children?: Node[] };
const tree: Node = {
    name: 'root',
    children: [
        { name: 'a', children: [{ name: 'target', children: [{ name: 'never-visited' }] }] },
        { name: 'b' },
    ],
};
// 先序 DFS:先吐自己,再逐个子树委托;yield* 递归让"遍历器"可以像同步函数一样递归书写
function* walk(node: Node): Generator<Node> {
    yield node;
    for (const child of node.children ?? []) yield* walk(child);
}
console.log('全树节点:', [...walk(tree)].length); // 5

// 惰性剪枝:break 触发 return(),沿委托链逐层收尾,b 与 never-visited 根本不会被访问
let visited = 0;
let found: Node | undefined;
for (const n of walk(tree)) {
    visited++;
    if (n.name === 'target') {
        found = n;
        break;
    }
}
console.log('剪枝访问:', visited, '/ 5 | 命中:', found?.name); // 3 / 5 | target

// ============ 3. it.throw():向"暂停的那条 yield"处注入错误 ============
log('3. throw 注入:finally 照常执行,生成器随即终结');

function* withCleanup() {
    try {
        yield 'step-1';
        yield 'step-2';
    } finally {
        console.log('生成器清理(在暂停点触发,相当于局部 finally)');
    }
}
const it = withCleanup();
console.log(it.next().value); // step-1:此刻生成器暂停在第一个 yield
try {
    it.throw(new Error('外部注入的错误')); // 错误从暂停的 yield 处抛出:等价于"yield 表达式 throw 了"
} catch (e) {
    console.log('外部捕获:', (e as Error).message); // 内部无 catch,错误穿透,但 finally 已先执行
}

// ============ 4. 消费者驱动的双向通道:next(参数) 当"拉模式背压" ============
log('4. 双向通信:生产节奏由消费者拉动');

function* producer(): Generator<string, string, number> {
    let acks = 0;
    while (acks < 3) {
        acks += yield `包裹 ${acks + 1} 已发出,回复 1 表示签收`; // 注入值 = 上一条 yield 的返回值
    }
    return '全部签收';
}
const channel = producer();
let msg = channel.next(); // 首次 next() 只负责启动到第一个 yield,传参无效
while (!msg.done) {
    console.log('生产者:', msg.value);
    msg = channel.next(1); // 消费者每次注入 1,主动拉动下一条(想要多少取多少)
}
console.log('最终:', msg.value); // done 时的 value 是 return 值

// ============ 5. 生成器状态机:yield 序列天然表达"状态流转" ============
log('5. 状态机:红绿灯循环(状态即产出,历史即序列)');

function* trafficLight(cycles: number): Generator<string> {
    const states = ['红', '绿', '黄'] as const; // 转移表收敛在数组里,加状态只改一处
    for (let c = 0; c < cycles; c++) yield* states;
}
console.log([...trafficLight(2)].join(' → ')); // 红 → 绿 → 黄 → 红 → 绿 → 黄
// 注意:生成器是一次性迭代器,重放需重新调用 trafficLight() 生成新实例

// ============ 6. 生成器版洋葱模型:Koa 1 中间件原理(yield* next() = 控制权下沉) ============
log('6. 洋葱模型:yield* 委托形成先进后出的包裹结构');

type Ctx = { logs: string[] };
type G = Generator<void, void, void>;
type GenMiddleware = (ctx: Ctx, next: () => G) => G;
// compose 从 i 开始构建一条"委托链":当前中间件 yield* 内层,内层跑完控制权自然回到当前层
function composeGen(mws: GenMiddleware[]) {
    return function* dispatch(ctx: Ctx, i = 0): G {
        if (i >= mws.length) return; // 最内层:链尾即终点
        yield* mws[i](ctx, () => dispatch(ctx, i + 1));
    };
}
const ctx: Ctx = { logs: [] };
const run = composeGen([
    function* (c, next) {
        c.logs.push('A-前');
        yield* next(); // 控制权交给 B;B 全部完成后才回到这里继续写"后置逻辑"
        c.logs.push('A-后');
    },
    function* (c, next) {
        c.logs.push('B-前');
        yield* next();
        c.logs.push('B-后');
    },
])(ctx); // 组合结果本身是生成器:创建一次,驱动到完成
let step = run.next();
while (!step.done) step = run.next();
console.log(ctx.logs.join(' → ')); // A-前 → B-前 → B-后 → A-后(先进后出)
