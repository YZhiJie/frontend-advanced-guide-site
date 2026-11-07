// 文件: examples/18-08-message-channel.ts
// 对应 18.4.1：MessageChannel 基本模型
// Node 18+ 全局自带 MessageChannel / MessagePort（与浏览器 API 同名同语义），可直接实跑；
// 浏览器中同样可用，消息投递一定是异步的。
import assert from "node:assert/strict";

// 创建一对相互连通的端口
const channel = new MessageChannel();
const port1 = channel.port1;
const port2 = channel.port2;

const received = new Promise<string>((resolve) => {
  port1.onmessage = (e) => {
    console.log("port1 收到:", e.data);
    resolve(String(e.data));
  };
});

port2.postMessage("你好"); // 异步排队，非同步执行
console.log("port2 已发送，等待异步回包…");

assert.equal(await received, "你好");

port1.close();
port2.close();
console.log("✓ 18-08 MessageChannel 收发断言通过");
