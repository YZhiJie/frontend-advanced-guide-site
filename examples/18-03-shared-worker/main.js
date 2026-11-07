// 文件: examples/18-03-shared-worker/main.js
// 页面侧：连接 SharedWorker，用 port 收发消息，并维护心跳。

// 同源 + 相同脚本 URL + 相同 name → 多个 Tab 复用同一实例
const sw = new SharedWorker('./counter.shared.js', 'demo-shared-counter');
const port = sw.port;

port.onmessage = (e) => {
    const d = e.data;
    if (d.type === 'HELLO') {
        document.querySelector('#pid').textContent = d.portId;
        document.querySelector('#count').textContent = d.count;
        document.querySelector('#online').textContent = d.online;
    } else if (d.type === 'STATE' || d.type === 'PEERS') {
        document.querySelector('#count').textContent = d.count;
        document.querySelector('#online').textContent = d.online;
    }
};

document.querySelector('#inc').addEventListener('click', () => {
    port.postMessage({ type: 'INC' });
});

// 心跳：每 3s 通知 Worker 本页存活
setInterval(() => port.postMessage({ type: 'PING' }), 3000);

// 正常退出礼貌通知（崩溃场景由 Worker 心跳扫描兜底）
window.addEventListener('beforeunload', () => {
    port.postMessage({ type: 'LEAVE' });
});
