/**
 * 17-08 新能力快速上手 —— Clipboard / OPFS / Wake Lock / Screen Capture / CSS :has() / Container Queries
 * [浏览器] 需在页面环境运行,以阅读理解为主。
 */

// ============ Clipboard:富文本/图片异步剪贴板 ============

// 写入富文本:告别 execCommand('copy')
async function copyRichText(text: string, html?: string) {
    if (html) {
        const blob = new Blob([html], { type: 'text/html' });
        const textBlob = new Blob([text], { type: 'text/plain' });
        await navigator.clipboard.write([new ClipboardItem({
            'text/html': blob,
            'text/plain': textBlob,
        })]);
    } else {
        await navigator.clipboard.writeText(text);
    }
}
// ⚠️ ClipboardItem 的值必须是 Blob,不能直接写字符串(Chrome 限制)
// ⚠️ write 在非用户手势触发的回调中会失败(SecurityError) —— 必须在 click 事件链中调用

// ---- OPFS:页面私有高性能文件系统(比 IDB 快,同步访问在 Worker 中)----
async function opfsDemo() {
    const root = await navigator.storage.getDirectory(); // OPFS 根目录
    const file = await root.getFileHandle('cache.bin', { create: true });
    const w = await file.createWritable();
    await w.write(new Uint8Array([1, 2, 3])); // 写入二进制
    await w.close();

    const r = await file.getFile();
    const buf = await r.arrayBuffer();
    console.log(new Uint8Array(buf)); // [1, 2, 3]

    // ⚠️ 主线程的 OPFS 读写是异步的;Worker 中可用 createSyncAccessHandle 获得同步 IO
    // 同步 IO 消除了 Promise 开销 —— 音频/视频帧级处理的理想存储
}

// ---- Wake Lock:防止屏幕熄灭(全屏播放器/导航/烹饪)----
let wakeLock: WakeLockSentinel | null = null;
async function requestWakeLock() {
    if (!navigator.wakeLock) return;
    wakeLock = await navigator.wakeLock.request('screen');
    // ⚠️ 页面失焦(切后台/最小化)时 Wake Lock 自动释放,回来后需重新请求
    document.addEventListener('visibilitychange', async () => {
        if (wakeLock !== null && document.visibilityState === 'visible') {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    });
}

// ---- Screen Capture:标签页/窗口录屏(远程协作/截图分享)----
async function shareScreen() {
    const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false, // true 可捕获标签页音频
    });
    // stream 可喂给 <video>、WebRTC、MediaRecorder
    // ⚠️ 用户每次都需要手动选择共享内容 —— 浏览器不允许静默录屏(安全)
    // ⚠️ 用户可勾选"共享音频" → audio track 存在,但不是所有标签都支持
    return stream;
}

// ---- CSS :has() 选择器:不再需要 JS 判断后加类名 ----
// CSS:
//   .card:has(img) { padding: 0; }          /* 有图时去 padding */
//   form:has(input:invalid) .submit { opacity: .5; pointer-events: none; } /* 表单有错时禁用按钮 */
//   div:has(> .sticky) { position: relative; } /* 子级有 sticky 时父级设 relative */
// JS 等价(被替代):if (form.querySelector('input:invalid')) btn.disabled = true;

// ---- Container Queries:容器尺寸响应(而非视口)----
// CSS:
//   .sidebar { container-type: inline-size; }  /* 声明容器 */
//   @container (min-width: 300px) { .card { flex-direction: row; } } /* 容器够宽就横排 */
// 解决:侧栏宽度取决于父布局,不只跟视口走 —— @media 永远不知道组件容器多大

export {};
