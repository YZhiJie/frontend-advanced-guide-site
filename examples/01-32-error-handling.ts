// 文件: examples/01-32-error-handling.ts
// ============ JS 错误处理体系:错误类型 / 自定义错误 / cause 链 / 边界策略 / ES2026 前瞻 ============
// 运行:npx tsx examples/01-32-error-handling.ts

export {};

// 当前 tsconfig 的 lib 为 ES2020,用全局增强补充 ES2022 ErrorOptions 构造重载(运行时早已支持)
declare global {
    interface ErrorConstructor {
        new (message?: string, options?: { cause?: unknown }): Error;
    }
}

const log = (title: string) => console.log(`\n---- ${title} ----`);

// ============ 1. 内建错误类型谱系 ============
log('1. 内建错误类型');

// 每种错误类型对应一类"典型成因",抛出时应选最贴近语义的内建类型
const triggers: Array<[string, () => void]> = [
    ['RangeError     (值超出合法范围)', () => { (1).toFixed(-1); }],
    ['TypeError      (类型不允许的操作)', () => { (null as unknown as { x: number }).x; }],
    ['SyntaxError    (语法不合法)', () => JSON.parse('{非法json}')],
    ['URIError       (encode/decode 遇到非法序列)', () => decodeURIComponent('%')],
    ['ReferenceError (引用了未声明的变量)', () => { (0, eval)('notDefinedAnywhere'); }],
];

for (const [label, trigger] of triggers) {
    try {
        trigger();
    } catch (e) {
        console.log(`  ${label} -> 实际 ${(e as Error).name}`);
    }
}
console.log('  (EvalError 仅为历史兼容保留,现代引擎不再主动抛出)');
console.log('  共同结构:name(类型) + message(信息) + stack(调用栈,V8 还可用 Error.captureStackTrace 裁剪)');

// ============ 2. 自定义错误:throw 的只能是"语义明确"的错误 ============
log('2. 自定义错误层级');

class AppError extends Error {
    // 业务错误基类:附带错误码与原因链,便于日志检索与前端精细化提示
    constructor(
        message: string,
        public code: string,
        options?: { cause?: unknown },
    ) {
        super(message, options); // ES2022:第二参数 { cause } 会被基类自动保存
        this.name = new.target.name; // 子类原型修正:保证 err.name 是实际类名而非固定 'Error'
    }
}
class ValidationError extends AppError {
    constructor(
        message: string,
        public fields: string[],
    ) {
        super(message, 'VALIDATION_FAILED');
    }
}
class HttpError extends AppError {
    constructor(
        message: string,
        public status: number,
        cause?: unknown,
    ) {
        super(message, `HTTP_${status}`, { cause });
    }
}

const ve = new ValidationError('参数不合法', ['email', 'age']);
console.log('  name:', ve.name, '| code:', ve.code, '| instanceof 链:', ve instanceof AppError, ve instanceof Error);
console.log('  附加字段:', ve.fields);

// ============ 3. ES2022 Error.cause:错误转译时不丢根因 ============
log('3. cause 错误因果链');

function parseConfig(raw: string) {
    try {
        return JSON.parse(raw); // 底层错误:SyntaxError
    } catch (lowLevel) {
        // 边界层"转译"错误:抛出业务语义,同时用 cause 保留原始错误
        throw new HttpError('配置解析失败,服务暂不可用', 500, lowLevel);
    }
}

try {
    parseConfig('{broken');
} catch (e) {
    // 沿 cause 链向上追溯,日志中能同时看到"业务错误"和"技术根因"
    let cur: unknown = e;
    let depth = 0;
    while (cur) {
        if (cur instanceof Error) {
            console.log(`${'  '.repeat(depth)}└─ ${cur.name}: ${cur.message}`);
            cur = (cur as { cause?: unknown }).cause;
            depth++;
        } else {
            break;
        }
    }
}

// ============ 4. catch 绑定 unknown:类型收窄后才能访问 message ============
log('4. unknown 与错误归一化');

try {
    throw '后端直接返回了字符串错误码 500'; // 合法但极不推荐:throw 可以抛任意值
} catch (e) {
    // strict 模式下 catch 变量是 unknown,不能直接 e.message
    const normalized =
        e instanceof Error ? e : new Error(`非 Error 抛出值被归一化: ${String(e)}`);
    console.log(' ', normalized.message);
}

// ES2026 Error.isError:跨 iframe/Worker/realm 也可靠(那些 realm 的 Error 不是同一个构造器)
function isErrorLike(value: unknown): value is Error {
    if (typeof (Error as unknown as { isError?: (v: unknown) => boolean }).isError === 'function') {
        return (Error as unknown as { isError: (v: unknown) => boolean }).isError(value);
    }
    // 兜底:toString 标签跨 realm 仍然有效;instanceof 跨 realm 会失效
    return Object.prototype.toString.call(value) === '[object Error]';
}
console.log('  类型守卫:', isErrorLike(new TypeError()), isErrorLike({ message: 'x' })); // true false

// ============ 5. try/catch/finally 的执行顺序 ============
log('5. finally 的时序与陷阱');

function normalFlow() {
    try {
        console.log('  1. try 执行');
        return 'try 的返回值';
    } catch {
        return 'catch 的返回值';
    } finally {
        // finally 一定执行:即使 try 里 return/break/continue —— 在"返回值已求值但尚未交回调用方"之间插入
        console.log('  2. finally 执行(常用于关闭连接/释放锁/还原状态)');
    }
}
console.log('  3. 调用方收到:', normalFlow());

function swallowedError() {
    try {
        throw new Error('原始异常');
    } finally {
        // ⚠️ 反模式:finally 里 return/throw 会覆盖 try 中待抛出的异常,错误被静默吞掉
        return '异常被 finally 的 return 吞了';
    }
}
console.log(' ', swallowedError()); // 正常返回字符串 —— 排查问题的噩梦,务必避免

// 可选 catch 绑定(ES2019):不需要错误对象时省略括号
try {
    JSON.parse('bad');
} catch {
    console.log('  catch {} 无需绑定错误对象的写法');
}

// ============ 6. AggregateError:一组错误打包抛出 ============
log('6. AggregateError(Promise.any 全 reject 时)');

try {
    // Promise.any 全部失败时抛出 AggregateError(ES2021),errors 字段保留每一个失败原因
    await (Promise as any).any([
        Promise.reject(new Error('节点 A 超时')),
        Promise.reject(new Error('节点 B 超时')),
    ]);
} catch (e) {
    const aggregated = e as { name: string; errors: Error[] };
    console.log(' ', aggregated.name === 'AggregateError', '| name:', aggregated.name);
    console.log('  errors 数组:', aggregated.errors.map((x) => x.message));
}

// ES2027 SuppressedError:资源清理失败时,主错误与清理错误同时保留(详见 01-29)
const SE = (globalThis as any).SuppressedError;
if (SE) {
    const suppressed = new SE(new Error('rollback 失败'), new Error('主流程失败'), 'transaction');
    console.log('  SuppressedError 双错误保留:', suppressed.error.message, '+', suppressed.suppressed.message);
}

// ============ 7. 推荐的工程策略:只在边界 catch + Result 模式 ============
log('7. 错误处理工程策略');

// 策略一:深层函数只 throw 语义化错误,不做无意义的层层 try/catch(避免吞错与重复日志)
async function loadUser(id: number): Promise<{ id: number; name: string }> {
    if (id <= 0) throw new ValidationError('用户 id 必须为正', ['id']);
    return { id, name: '阿黄' };
}

// 策略二:边界层(路由/事件处理器/任务入口)统一收口,转译为用户可理解的结果
type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };
async function toResult<T>(promise: Promise<T>): Promise<Result<T>> {
    try {
        return { ok: true, value: await promise };
    } catch (e) {
        const error =
            e instanceof AppError
                ? e
                : new AppError(e instanceof Error ? e.message : '未知错误', 'INTERNAL', { cause: e });
        return { ok: false, error };
    }
}

const good = await toResult(loadUser(1));
const bad = await toResult(loadUser(-1));
if (good.ok) console.log('  成功分支:', good.value);
if (!bad.ok)
    console.log('  失败分支(无异常中断,调用方按数据处理):', bad.error.code, (bad.error as ValidationError).fields);
console.log('  原则:① 错误不静默(空 catch 是 bug 温床)② 就近抛出、边界统一处理 ③ 错误信息对用户/日志分层');
