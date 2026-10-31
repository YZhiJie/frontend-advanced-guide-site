// 文件: examples/25-06-broadcast-channel.ts —— BroadcastChannel 跨上下文广播
// ============ 同源跨 Tab 的广播总线,Node 18+ 内置同名实现,收发语义与浏览器一致============
export {}; // 顶层 await 需要 ESM 模块语义

// 场景:多 Tab 共享「登录态」。任一 Tab 退出登录,其它 Tab 立即响应,无需轮询。
// 浏览器里每个 Tab 一个实例;这里用 ch1/ch2 两个实例模拟两个 Tab。

type AuthEvent = { type: "logout" | "login"; token?: string };

const tabA = new BroadcastChannel("auth");
const tabB = new BroadcastChannel("auth"); // 同名频道即同一总线

const inbox: AuthEvent[] = [];
tabB.onmessage = (e: MessageEvent<AuthEvent>) => {
  // 结构化克隆送达:e.data 与发送方已断开引用,改它不会影响发送方
  inbox.push(e.data);
  console.log(
    `  TabB 收到: type=${e.data.type}${e.data.token ? " token=" + e.data.token : ""}`,
  );
};

// 未监听的第三实例也能发,消息广播给「其它所有」同名频道(不含自己)
console.log("TabA 发出 logout:");
tabA.postMessage({ type: "logout" } satisfies AuthEvent);

console.log("TabA 发出 login(带 token):");
tabA.postMessage({ type: "login", token: "jwt-abc" } satisfies AuthEvent);

// 等待事件循环派发(消息是异步送达的)
await new Promise((r) => setTimeout(r, 20));

// 坑点演示:消息经结构化克隆,不是引用共享
const shared = { list: [1, 2] };
let received: { list: number[] } | undefined;
const ch1 = new BroadcastChannel("clone-probe");
const ch2 = new BroadcastChannel("clone-probe");
ch2.onmessage = (e) => {
  received = e.data;
};
ch1.postMessage(shared);
await new Promise((r) => setTimeout(r, 20));
received?.list.push(999);
console.log(
  "改收到的副本,发送方不受影响:",
  shared.list.length === 2 ? "是(结构化克隆)" : "否",
);

// 生命周期:用完必须 close,否则频道对象常驻(内存/通知开销)
console.log("\n收尾:", inbox.length, "条消息;关闭全部频道");
tabA.close();
tabB.close();
ch1.close();
ch2.close();

// 对照速记(详见正文):
//   BroadcastChannel —— 同源同设备「广播」,无偶尔回执,最适合状态扇出
//   MessageChannel   —— 两端「点对点」管道,可转移(transfer)Buffer,适合大数据
//   Web Locks        —— 跨 Tab「互斥/共享锁」,适合 Leader 选举,不是消息通道
//   postMessage      —— 跨「不同源窗口/iframe」的唯一合法通道,必须校验 targetOrigin
