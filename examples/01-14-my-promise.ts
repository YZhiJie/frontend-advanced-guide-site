// 文件: examples/01-14-my-promise.ts
// ============ 手写简化版 Promise(教学版,非 A+ 全量实现)============

type State = 'pending' | 'fulfilled' | 'rejected';
type Executor<T> = (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: unknown) => void) => void;
type Callback<T, R> = (value: T) => R;

class MyPromise<T> {
    private state: State = 'pending';
    private value!: T;
    private reason!: unknown;
    private callbacks: Array<{ ok: Callback<T, unknown>; fail: (e: unknown) => unknown }> = [];

    constructor(executor: Executor<T>) {
        const resolve = (value: T | PromiseLike<T>) => {
            if (this.state !== 'pending') return;          // 状态不可逆
            // resolve 的值如果本身是 thenable,等它落定(链式解包的关键)
            if (value && typeof (value as PromiseLike<T>).then === 'function') {
                (value as PromiseLike<T>).then(resolve, reject);
                return;
            }
            this.state = 'fulfilled';
            this.value = value as T;
            this.flush();
        };
        const reject = (reason?: unknown) => {
            if (this.state !== 'pending') return;
            this.state = 'rejected';
            this.reason = reason;
            this.flush();
        };
        try {
            executor(resolve, reject);
        } catch (e) {
            reject(e); // executor 同步抛错 → 直接 reject
        }
    }

    // 用微任务模拟异步执行回调(真实 Promise 遵循同样的时机)
    private flush() {
        queueMicrotask(() => {
            this.callbacks.forEach(({ ok, fail }) => {
                try {
                    if (this.state === 'fulfilled') ok(this.value);
                    else fail(this.reason);
                } catch (e) {
                    // 注意:这里简化处理,完整实现应让后续 promise reject
                    console.error('回调执行出错(教学版简化):', e);
                }
            });
            this.callbacks = [];
        });
    }

    then<R1 = T, R2 = never>(
        onFulfilled?: Callback<T, R1 | PromiseLike<R1>> | null,
        onRejected?: Callback<unknown, R2 | PromiseLike<R2>> | null,
    ): MyPromise<R1 | R2> {
        return new MyPromise<R1 | R2>((resolve, reject) => {
            const handle = () => {
                try {
                    if (this.state === 'fulfilled') {
                        // 回调返回值可能又是 promise,交给新 promise 的 resolve 解包
                        resolve((onFulfilled ? onFulfilled(this.value) : this.value) as any);
                    } else {
                        if (!onRejected) return reject(this.reason); // 没有失败回调 → 错误继续向后传
                        resolve(onRejected(this.reason) as any);     // 失败被处理 → 返回成功链
                    }
                } catch (e) {
                    reject(e);
                }
            };
            this.callbacks.push({ ok: handle, fail: handle });
            if (this.state !== 'pending') this.flush(); // 已落定时注册的回调直接执行
        });
    }

    catch<R = never>(onRejected: Callback<unknown, R | PromiseLike<R>>) {
        return this.then(null, onRejected);
    }

    finally(cb: () => void) {
        // 无论成败都执行 cb,并把原值/原错误透传下去
        return this.then(
            (v) => MyPromise.resolve(cb()).then(() => v),
            (e) => MyPromise.resolve(cb()).then(() => { throw e; }),
        );
    }

    static resolve<T>(value?: T | PromiseLike<T>) {
        return new MyPromise<T>((resolve) => resolve(value as T));
    }
    static reject<T = never>(reason?: unknown) {
        return new MyPromise<T>((_, reject) => reject(reason));
    }
}

// ---- 验证 ----
MyPromise.resolve(1)
    .then((v) => v + 1)
    .then((v) => MyPromise.resolve(v * 10)) // 返回 promise 会被自动解包
    .then((v) => {
        console.log('链式结果:', v); // 20
        throw new Error('手动抛错');
    })
    .catch((e) => console.log('捕获:', e.message)) // 错误沿链传递到 catch
    .finally(() => console.log('finally 总是执行'));
