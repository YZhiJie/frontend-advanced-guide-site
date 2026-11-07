// 文件: examples/05-02-persist-migrate.ts
// ============ store 持久化:序列化信封 + 版本迁移链 + 坏数据容错 ============
// 设计决策:
// 1. 存储抽象成 StorageLike:浏览器传 localStorage,Node/测试传内存实现,
//    持久化逻辑因此可单测,SSR 环境也能安全跳过;
// 2. 落盘的不是裸 state,而是带 version 的信封 { version, data } —— 版本号是迁移的锚点;
// 3. 读到旧版本时按 0→1→2 逐级跑迁移函数,而不是"结构对不上就清空重来";
// 4. 解析失败、版本超前(用户回滚到旧代码)一律当作无数据 —— 坏数据不允许带进内存。

/** 存储适配器:localStorage / sessionStorage / 内存 mock 都满足这个形状 */
interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** Node/测试用的内存实现(浏览器里直接传 localStorage 即可) */
class MemoryStorage implements StorageLike {
    private map = new Map<string, string>();

    getItem(key: string): string | null {
        return this.map.has(key) ? (this.map.get(key) as string) : null;
    }

    setItem(key: string, value: string): void {
        this.map.set(key, value);
    }

    removeItem(key: string): void {
        this.map.delete(key);
    }
}

// ---- 当前 schema(v2):主题 + 带数量的购物车 ----
interface RootState {
    theme: 'light' | 'dark';
    cart: { id: string; qty: number }[];
}

const KEY = 'fag-cart';
const CURRENT_VERSION = 2;

/** 迁移函数:输入上一版结构,输出下一版结构 */
const migrations: Record<number, (old: any) => any> = {
    // v0 → v1:布尔 darkMode 改名成 theme
    0: (old) => ({ theme: old.darkMode ? 'dark' : 'light', cart: old.cart }),
    // v1 → v2:cart 从 string[](只存 id)升级成 { id, qty }[],数量默认 1
    1: (old) => ({
        theme: old.theme,
        cart: (old.cart as string[]).map((id) => ({ id, qty: 1 })),
    }),
};

function migrate(raw: { version: number; data: any }): RootState | null {
    let version = raw.version;
    let data = raw.data;
    if (version > CURRENT_VERSION) return null; // 用户回滚了代码,旧代码读不懂新数据
    while (version < CURRENT_VERSION) {
        const step = migrations[version];
        if (!step) return null; // 缺迁移函数:宁可放弃,不可瞎猜
        data = step(data);
        version++;
        console.log(`  ↳ 迁移 v${version - 1} → v${version}`);
    }
    return data as RootState;
}

function createPersist(storage: StorageLike) {
    return {
        save: (state: RootState) =>
            storage.setItem(
                KEY,
                JSON.stringify({ version: CURRENT_VERSION, data: state }),
            ),
        load: (): RootState | null => {
            const text = storage.getItem(KEY);
            if (!text) return null;
            try {
                return migrate(JSON.parse(text));
            } catch {
                return null; // 存储被污染(手改 / 半截写入):当无数据,绝不崩首屏
            }
        },
    };
}

// ---- 场景:老用户浏览器里躺着 v0 数据 ----
const storage = new MemoryStorage();
storage.setItem(
    KEY,
    JSON.stringify({ version: 0, data: { darkMode: true, cart: ['s-1', 's-2'] } }),
);

const persist = createPersist(storage);
console.log('恢复结果:', persist.load()); // v0 逐级迁移到 v2

persist.save({ theme: 'dark', cart: [{ id: 's-1', qty: 2 }] });
console.log('落盘:', storage.getItem(KEY)); // 信封带上了当前版本号

// ---- 坏数据不崩首屏 ----
storage.setItem(KEY, '{ 半截写入');
console.log('坏数据恢复:', persist.load());
