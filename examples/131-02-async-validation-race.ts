// 文件: examples/131-02-async-validation-race.ts
// 131.5 异步校验：竞态守卫、同值合并、结果缓存、规则版本失效。
// 纯 TS、注入时钟、零网络，npx tsx 实跑。
import assert from "node:assert/strict";

export interface ValidationResult {
  ok: boolean;
  message?: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * 异步字段校验器。
 * - 同字段并发：只有最后一次发起的校验结果被采纳，旧结果标记 stale；
 * - 同字段同值并发：共享同一个 Promise，避免重复请求；
 * - 结果缓存：key 里带规则版本，规则升级后旧缓存自动失效；
 * - 提交前可 await 最后一次校验（真实库里对应 trigger/validateField）。
 */
export class AsyncFieldValidator {
  #cache = new Map<string, ValidationResult>();
  #inflight = new Map<string, Promise<ValidationResult | "stale">>();
  #latestSeq = new Map<string, number>();
  #seq = 0;
  #ruleVersion = 1;
  #calls = 0;

  constructor(private readonly check: (value: string) => Promise<ValidationResult>) {}

  get calls(): number {
    return this.#calls;
  }

  bumpRuleVersion(): void {
    this.#ruleVersion++;
    this.#cache.clear();
    // 在途请求不取消，但它们的 seq 会因为#latestSeq 未变而在返回时被判定 stale
    this.#latestSeq.clear();
  }

  async validate(field: string, value: string): Promise<ValidationResult | "stale"> {
    const key = `${this.#ruleVersion}::${field}::${value}`;
    const cached = this.#cache.get(key);
    if (cached) return cached;

    const running = this.#inflight.get(key);
    if (running) return running; // 同值并发合并

    const seq = ++this.#seq;
    this.#latestSeq.set(field, seq);
    this.#calls++;

    const task = this.check(value).then((result) => {
      this.#inflight.delete(key);
      this.#cache.set(key, result);
      // 期间该字段又发起了更新的校验：本次结果作废
      return this.#latestSeq.get(field) === seq ? result : ("stale" as const);
    });
    this.#inflight.set(key, task);
    return task;
  }
}

// ---------------- 断言 ----------------
const pendingByName = new Map<string, Deferred<ValidationResult>>();
const validator = new AsyncFieldValidator((value) => {
  const d = deferred<ValidationResult>();
  pendingByName.set(value, d);
  return d.promise;
});

// 1) 慢的旧请求先返回也不能覆盖新请求的结果
const first = validator.validate("username", "alice");
const second = validator.validate("username", "alic");
assert.equal(validator.calls, 2, "两次不同值各发一次");

pendingByName.get("alice")!.resolve({ ok: true });
assert.equal(await first, "stale", "旧值的结果被判定过期");

pendingByName.get("alic")!.resolve({ ok: false, message: "昵称已被占用" });
assert.deepEqual(await second, { ok: false, message: "昵称已被占用" }, "最新一次结果生效");

// 2) 命中缓存：不再发请求
const cached = await validator.validate("username", "alic");
assert.deepEqual(cached, { ok: false, message: "昵称已被占用" });
assert.equal(validator.calls, 2, "缓存命中不增加请求数");

// 3) 同字段同值并发：共享同一个 Promise
const pa = validator.validate("email", "a@b.com");
const pb = validator.validate("email", "a@b.com");
assert.equal(validator.calls, 3, "同值并发只发一次");
pendingByName.get("a@b.com")!.resolve({ ok: true });
const [a, b] = await Promise.all([pa, pb]);
assert.deepEqual(a, { ok: true });
assert.deepEqual(b, { ok: true }, "两个调用拿到同一结果");

// 4) 规则版本升级：旧缓存失效，必须重新校验
validator.bumpRuleVersion();
const afterBump = validator.validate("username", "alic");
assert.equal(validator.calls, 4, "规则版本变化后重新请求");
pendingByName.get("alic")!.resolve({ ok: true });
assert.deepEqual(await afterBump, { ok: true }, "新规则下的结果");

// 5) 表单提交前的「最后一次结果」语义：后发起的请求先返回，先发起的后返回
const slow = validator.validate("phone", "13800000000");
const fast = validator.validate("phone", "1380000000");
pendingByName.get("1380000000")!.resolve({ ok: false, message: "手机号位数不对" });
assert.deepEqual(await fast, { ok: false, message: "手机号位数不对" });
pendingByName.get("13800000000")!.resolve({ ok: true });
assert.equal(await slow, "stale", "先发起、后返回的请求不能翻盘");

// 6) 失败结果同样进缓存：避免每次 blur 都打一次接口
const again = await validator.validate("phone", "1380000000");
assert.deepEqual(again, { ok: false, message: "手机号位数不对" });
assert.equal(validator.calls, 6, "失败结果也命中缓存");

console.log("✓ 131-02 异步校验竞态、合并、缓存与规则版本断言全部通过");
