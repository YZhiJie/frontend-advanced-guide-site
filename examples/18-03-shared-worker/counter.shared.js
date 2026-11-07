// 文件: examples/18-03-shared-worker/counter.shared.js
// SharedWorker：同源多页面共享这一个实例。count、ports 在所有 Tab 间共享。
// 全局环境是 SharedWorkerGlobalScope，连接入口是 onconnect。

let count = 0;
let seq = 0;
const ports = new Map(); // portId -> { port, lastSeen }
const HEARTBEAT_TIMEOUT = 8000;

function snapshot() {
  return { count, online: ports.size };
}

function broadcast(msg) {
  // 扇出给所有端口；向已失效端口发送会抛错，惰性剔除
  for (const [id, entry] of ports) {
    try {
      entry.port.postMessage(msg);
    } catch {
      ports.delete(id);
    }
  }
}

self.onconnect = (e) => {
  const port = e.ports[0];
  const portId = `p${++seq}`;
  ports.set(portId, { port, lastSeen: Date.now() });

  // 新连接先拿到当前全量状态（BroadcastChannel 做不到的"上线即同步"）
  port.postMessage({ type: "HELLO", portId, ...snapshot() });
  broadcast({ type: "PEERS", ...snapshot() });

  port.onmessage = (ev) => {
    const entry = ports.get(portId);
    if (!entry) return;

    if (ev.data.type === "PING") {
      entry.lastSeen = Date.now(); // 心跳续命
      return;
    }
    if (ev.data.type === "INC") {
      count++;
      broadcast({ type: "STATE", from: portId, ...snapshot() });
      return;
    }
    if (ev.data.type === "LEAVE") {
      // 页面正常关闭；崩溃场景靠下面的定时扫描兜底
      ports.delete(portId);
      broadcast({ type: "PEERS", ...snapshot() });
      port.close();
    }
  };
};

// 僵尸端口清理：Tab 崩溃/被杀时 beforeunload 不会执行，心跳超时即剔除
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, entry] of ports) {
    if (now - entry.lastSeen > HEARTBEAT_TIMEOUT) {
      ports.delete(id);
      changed = true;
    }
  }
  if (changed) broadcast({ type: "PEERS", ...snapshot() });
}, 3000);
