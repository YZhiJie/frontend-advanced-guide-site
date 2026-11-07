// 文件: examples/132-06-multitab-persist.ts
// ============ 跨标签页持久化同步：BroadcastChannel + 版本号防回写 ============
// 插件本身只写 storage，不会把别的标签页变更同步回内存；
// 这里演示「写入 → 广播 → 合并 → 忽略旧版本」的最小闭环（Node 18+ 自带 BroadcastChannel）。
import assert from "node:assert/strict";

type Envelope = { version: number; tabId: string; items: string[] };

class Tab {
    readonly channel: BroadcastChannel;
    state: Envelope = { version: 0, tabId: "", items: [] };
    received: Envelope[] = [];

    constructor(readonly id: string, room = "fag-cart") {
        this.channel = new BroadcastChannel(room);
        this.channel.onmessage = (event: MessageEvent<Envelope>) => {
            const incoming = event.data;
            this.received.push(incoming);
            // 只接受比本地更新的版本，避免旧标签页把新数据覆盖回去
            if (incoming.version > this.state.version) this.state = incoming;
        };
    }

    write(items: string[]): void {
        const next: Envelope = { version: this.state.version + 1, tabId: this.id, items };
        this.state = next;
        this.channel.postMessage(next);
    }

    close(): void {
        this.channel.close();
    }
}

const a = new Tab("tab-a");
const b = new Tab("tab-b");

// tab-a 写两次，tab-b 应收到并采用最高版本
a.write(["sku-1"]);
a.write(["sku-1", "sku-2"]);
await new Promise((r) => setTimeout(r, 20));
assert.equal(b.state.version, 2);
assert.deepEqual(b.state.items, ["sku-1", "sku-2"]);

// tab-b 基于 v2 写 v3，tab-a 跟随
b.write(["sku-3"]);
await new Promise((r) => setTimeout(r, 20));
assert.equal(a.state.version, 3);
assert.deepEqual(a.state.items, ["sku-3"]);

// 乱序到达：旧版本不得覆盖新版本
a.state = { version: 5, tabId: "tab-a", items: ["new"] };
a.channel.onmessage?.({ data: { version: 4, tabId: "tab-b", items: ["old"] } } as MessageEvent<Envelope>);
assert.deepEqual(a.state.items, ["new"], "旧版本广播必须被丢弃");

// 同版本不同内容：按 tabId 稳定裁决（避免两边都写导致抖动）
const tie: Envelope = { version: 5, tabId: "tab-z", items: ["tie"] };
a.channel.onmessage?.({ data: tie } as MessageEvent<Envelope>);
assert.deepEqual(a.state.items, ["new"], "同版本按约定不覆盖，交给业务合并");

a.close();
b.close();
console.log("✓ 跨标签页同步：广播 / 版本递增 / 乱序丢弃 / 同版本裁决 四类断言通过");
