export {};

/**
 * ES2026 / ES2027(候选) 新 API 的兼容性检测与统一降级封装
 *
 * 核心思路:能力探测只做一次 → 统一封装成 safe* / 兜底实现 → 业务代码零感知降级。
 * 新引擎(支持原生 API)自动走原生实现;旧引擎打印 ○ 标记并走降级分支,绝不崩。
 * 版本归属以 TC39 finished-proposals 清单为准:ES2026 已定稿,ES2027 组已达 Stage 4。
 */

import vm from 'node:vm';

// ─────────────────────────────────────────────
// 第 1 部分:能力探测(once),API 用 typeof/in,语法特性用 new Function 试解析
// ─────────────────────────────────────────────

const hasFn = (v: unknown): boolean => typeof v === 'function';
const G = globalThis as any;

const flags = {
    // ES2026(定稿)
    arrayFromAsync: hasFn((Array as any).fromAsync),
    errorIsError: hasFn((Error as any).isError),
    mathSumPrecise: hasFn((Math as any).sumPrecise),
    u8ToBase64: hasFn((Uint8Array.prototype as any).toBase64),
    u8FromBase64: hasFn((Uint8Array as any).fromBase64),
    iteratorConcat: hasFn(G.Iterator?.concat),
    iteratorZip: hasFn(G.Iterator?.zip),
    jsonRawJSON: hasFn((JSON as any).rawJSON),
    mapGetOrInsert: hasFn((Map.prototype as any).getOrInsert),
    // ES2027 候选(Stage 4)
    symbolDispose: typeof (Symbol as any).dispose === 'symbol',
    disposableStack: hasFn(G.DisposableStack),
    suppressedError: hasFn(G.SuppressedError),
    atomicsPause: hasFn((Atomics as any).pause),
    temporal: G.Temporal !== undefined,
    // using 是语法特性,typeof 探测不到:不支持 `using x = null` 的引擎会抛 SyntaxError
    usingSyntax: (() => {
        try {
            new Function('using x = null');
            return true;
        } catch {
            return false;
        }
    })(),
};

for (const [name, ok] of Object.entries(flags)) {
    console.log(`${ok ? '✓' : '○'} ${name.padEnd(20)}${ok ? '原生可用' : '走降级封装'}`);
}

// ─────────────────────────────────────────────
// 第 2 部分:统一降级封装(业务代码只 import 这些 safe*)
// ─────────────────────────────────────────────

/** Array.fromAsync:异步(或同步)可迭代 → 数组 */
const safeFromAsync = hasFn((Array as any).fromAsync)
    ? (src: AsyncIterable<unknown> | Iterable<unknown>) => (Array as any).fromAsync(src) as Promise<unknown[]>
    : async (src: AsyncIterable<unknown> | Iterable<unknown>) => {
          const out: unknown[] = [];
          for await (const item of src) out.push(item); // for await 兼吃同步可迭代
          return out;
      };

/** Error.isError:跨 realm(iframe/vm)判别;降级用 toString 标签,不受 realm 影响 */
const safeIsError = hasFn((Error as any).isError)
    ? (v: unknown) => (Error as any).isError(v) as boolean
    : (v: unknown) => Object.prototype.toString.call(v) === '[object Error]';

/** Math.sumPrecise:精确舍入求和;降级用 Neumaier 补偿求和(能找回"大数吃小数"的精度,仍非逐位精确,教学降级) */
const safeSumPrecise = hasFn((Math as any).sumPrecise)
    ? (xs: number[]) => (Math as any).sumPrecise(xs) as number
    : (xs: number[]) => {
          let sum = 0;
          let c = 0; // 补偿项:每步把 t=sum+x 丢失的精度捡回来
          for (const x of xs) {
              const t = sum + x;
              if (Math.abs(sum) >= Math.abs(x)) c += sum - t + x;
              else c += x - t + sum;
              sum = t;
          }
          return sum + c;
      };

/** Uint8Array.toBase64/fromBase64:降级用 String.fromCharCode 分块 + btoa/atob(浏览器与 Node 16+ 通用) */
const protoToB64 = (Uint8Array.prototype as any).toBase64;
const safeToBase64 = hasFn(protoToB64)
    ? (bytes: Uint8Array) => protoToB64.call(bytes) as string
    : (bytes: Uint8Array) => {
          let bin = '';
          const CHUNK = 0x8000; // 避免一次性展开超长参数列表
          for (let i = 0; i < bytes.length; i += CHUNK)
              bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
          return btoa(bin);
      };
const safeFromBase64 = hasFn((Uint8Array as any).fromBase64)
    ? (b64: string) => (Uint8Array as any).fromBase64(b64) as Uint8Array
    : (b64: string) => {
          const bin = atob(b64);
          const out = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
          return out;
      };

/** JSON.rawJSON:缺失时降级为"字符串嵌入",解析端按约定还原 BigInt */
const safeRawJSON = (raw: string): unknown =>
    hasFn((JSON as any).rawJSON) ? (JSON as any).rawJSON(raw) : raw;

/** Map/WeakMap upsert(ES2026):缺失时按提案语义补齐(不可枚举、可配置,将来可被原生无缝覆盖) */
function installUpsert(ctor: any): void {
    if (hasFn(ctor?.prototype?.getOrInsert)) return;
    Object.defineProperty(ctor.prototype, 'getOrInsert', {
        value: function (key: unknown, value: unknown) {
            if (!this.has(key)) this.set(key, value);
            return this.get(key);
        },
        writable: true,
        enumerable: false,
        configurable: true,
    });
}
installUpsert(Map);
installUpsert(WeakMap);

/** Iterator.concat / Iterator.zip:降级用生成器实现(zip 为短板取齐) */
const IteratorNS = G.Iterator ?? {};
const iterConcat = hasFn(IteratorNS.concat)
    ? IteratorNS.concat.bind(IteratorNS)
    : function* <T>(...sources: Iterable<T>[]) {
          for (const s of sources) yield* s;
      };
const iterZip = hasFn(IteratorNS.zip)
    ? IteratorNS.zip.bind(IteratorNS)
    : function* <T, U>(a: Iterable<T>, b: Iterable<U>) {
          const ia = a[Symbol.iterator]();
          const ib = b[Symbol.iterator]();
          for (;;) {
              const ra = ia.next();
              if (ra.done) return; // 任一耗尽即结束:短板取齐
              const rb = ib.next();
              if (rb.done) return;
              yield [ra.value, rb.value] as [T, U];
          }
      };

/** DisposableStack:缺失时提供等价迷你实现(LIFO 释放);配合 try/finally 模拟 using */
const DisposableStackCtor: any = hasFn(G.DisposableStack)
    ? G.DisposableStack
    : class {
          private stack: (() => void)[] = [];
          use(res: unknown): unknown {
              const d = (res as any)?.[(Symbol as any).dispose] ?? (res as any)?.dispose;
              if (typeof d === 'function') this.stack.push(() => d.call(res));
              return res;
          }
          defer(fn: () => void): void {
              this.stack.push(fn);
          }
          dispose(): void {
              while (this.stack.length) this.stack.pop()!(); // 后进先出,与原生语义一致
          }
      };

/** Atomics.pause:自旋提示,降级为空操作(不能真的暂停,只是语义占位) */
const pauseHint = hasFn((Atomics as any).pause)
    ? (iterations?: number) => (Atomics as any).pause(iterations)
    : (_iterations?: number) => {
          /* 降级:自旋提示不可用 */
      };

// ─────────────────────────────────────────────
// 第 3 部分:同一份业务代码,新旧引擎都不崩
// ─────────────────────────────────────────────

// ① fromAsync:消费异步生成器
async function* asyncIds(n: number) {
    for (let i = 1; i <= n; i++) yield i;
}
console.log('fromAsync:', await safeFromAsync(asyncIds(3))); // [1, 2, 3]

// ② isError:跨 realm 错误 instanceof 失效,safeIsError 仍识别
const crossRealmError: unknown = vm.runInNewContext('new Error("来自另一个 realm")');
console.log('instanceof 跨 realm:', crossRealmError instanceof Error); // false!
console.log('safeIsError 跨 realm:', safeIsError(crossRealmError)); // true

// ③ sumPrecise:[1e16, 1, -1e16] 数学上等于 1,朴素求和因大数吃掉小数得 0
const tricky = [1e16, 1, -1e16];
console.log('朴素 reduce:', tricky.reduce((a, b) => a + b, 0)); // 0
console.log('safeSumPrecise:', safeSumPrecise(tricky)); // 1

// ④ base64 往返
const bytes = Uint8Array.from([104, 105, 0xff]);
const b64 = safeToBase64(bytes);
console.log('base64 往返一致:', Array.from(safeFromBase64(b64)).join() === Array.from(bytes).join()); // true

// ⑤ 大整数 ID:原生 rawJSON 无损嵌入,降级为字符串嵌入;同一 reviver 双分支还原 BigInt
const wire = JSON.stringify({ orderId: safeRawJSON('9007199254740993123') });
type ParseCtx = { source?: string };
const reviver = (_k: string, v: unknown, ctx?: ParseCtx): unknown =>
    _k === 'orderId' ? BigInt(typeof ctx?.source === 'string' ? ctx.source : String(v)) : v;
const parsed = JSON.parse(wire, reviver as never) as { orderId: bigint };
console.log('订单号精度保持:', parsed.orderId === 9007199254740993123n); // true

// ⑥ upsert:词频计数一行搞定(当前引擎缺原生时走上面的兜底安装)
const freq = new Map<string, number>();
for (const w of ['a', 'b', 'a']) freq.set(w, (freq as any).getOrInsert(w, 0) + 1);
console.log('upsert 词频:', JSON.stringify([...freq])); // {"a":2,"b":1}

// ⑦ Iterator 组合:zip 短板取齐,concat 拼接
console.log('zip:', Array.from(iterZip(['a', 'b', 'c'], [90, 85]))); // [['a',90],['b',85]]
console.log('concat:', Array.from(iterConcat([1], [2, 3]))); // [1, 2, 3]

// ⑧ 资源管理:有原生 DisposableStack 用原生,否则走迷你实现;LIFO 释放
const resStack = new DisposableStackCtor();
resStack.use({ [(Symbol as any).dispose]: () => console.log('释放 A') }); // 原生要求 Symbol.dispose 键
resStack.defer(() => console.log('释放 B(defer)'));
resStack.dispose(); // 先 B 后 A

// 无 using 语法的引擎:try/finally 成对调用即 await using 的等价写法
console.log('获取连接');
try {
    await Promise.resolve();
    console.log('使用连接');
} finally {
    console.log('finally 释放连接(await using 等价写法)');
}

pauseHint(3);
console.log('---');
console.log('决策小抄: 语法特性用 new Function 试解析;API 用 typeof/in 检测;统一走 safe* 封装,不在业务代码散落检测');
