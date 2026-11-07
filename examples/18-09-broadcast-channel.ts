// 文件: examples/18-09-broadcast-channel.ts
// 对应 18.6.2：BroadcastChannel 同源广播
// Node 18+ 全局自带 BroadcastChannel，可直接实跑；浏览器中同一份代码跨 Tab 生效。
// ⚠️ 发送者自己收不到消息——Node 里用两个同名频道实例模拟两个 Tab。
import assert from "node:assert/strict";

type Msg = { type: "THEME_CHANGE"; theme: string; at: number };

const channel = new BroadcastChannel("app-channel");
const peer = new BroadcastChannel("app-channel");

const peerReceived = new Promise<Msg>((resolve) => {
  peer.onmessage = (e: MessageEvent<Msg>) => {
    console.log("peer 收到:", e.data.type, "→", e.data.theme);
    resolve(e.data);
  };
});

// ⚠️ 关键特性：消息会发给"其他"上下文，自己不会收到（无回声问题）；
// 同源的 Worker / SharedWorker / ServiceWorker 中也能创建同名频道；
// 不在线的 Tab 收不到历史消息（无持久化、无补发）。
const msg: Msg = { type: "THEME_CHANGE", theme: "dark", at: Date.now() };
channel.postMessage(msg);
console.log("channel 已广播（自己不会收到，peer 会收到）");

const got = await peerReceived;
assert.equal(got.type, "THEME_CHANGE");
assert.equal(got.theme, "dark");

peer.close();
channel.close();
console.log("✓ 18-09 BroadcastChannel 广播断言通过");
