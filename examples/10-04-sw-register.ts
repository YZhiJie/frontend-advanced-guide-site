// 文件: examples/10-04-sw-register.ts —— [浏览器] 注册与更新提示
export function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('load', async () => {
        const reg = await navigator.serviceWorker.register('/sw.js');

        // 检测到新版本在 waiting → 提示用户"有更新,点击刷新"
        reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker?.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    // 自定义 UI:让用户确认后执行跳过等待 + 刷新
                    showUpdateToast(() => {
                        newWorker.postMessage('SKIP_WAITING'); // SW 侧监听并 self.skipWaiting()
                    });
                }
            });
        });
    });
}

function showUpdateToast(onRefresh: () => void) {
    console.log('[PWA] 发现新版本');
    // UI 上渲染"立即更新"按钮,点击后调用 onRefresh 并 location.reload()
    void onRefresh;
}

// 💡 调试:DevTools → Application → Service Workers(Update on reload 便于开发)
//    ⚠️ 开发时 SW 缓存会干扰热更新,建议 dev 环境不注册
export {};
