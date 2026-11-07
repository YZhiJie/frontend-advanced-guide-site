// 文件: examples/07-05-qr-login.ts —— 扫码登录:轮询版(WS 版见 6.6)
// ============ 三步:取二维码 → 轮询状态 → 携带票据登录 ============

type QrStatus = 'waiting' | 'scanned' | 'confirmed' | 'expired';

async function qrLogin(onStatus: (s: QrStatus, ticket?: string) => void) {
    // ① 服务端生成二维码(含唯一 sceneId),前端展示
    const { sceneId } = await fetch('/api/auth/qr/create', { method: 'POST' }).then((r) => r.json());
    renderQrImage(`https://app.example.com/scan?sceneId=${sceneId}`);

    // ② 轮询状态(2s 一次;生产更优:SSE/WS 由服务端推送,见 6.6)
    return new Promise<string>((resolve, reject) => {
        const timer = setInterval(async () => {
            const { status, ticket } = await fetch(`/api/auth/qr/status?sceneId=${sceneId}`).then((r) => r.json());
            onStatus(status);

            if (status === 'confirmed' && ticket) {
                clearInterval(timer);
                // ③ 用一次性 ticket 换正式会话(ticket 60s 有效且仅可用一次)
                const { accessToken } = await fetch('/api/auth/qr/exchange', {
                    method: 'POST',
                    body: JSON.stringify({ ticket }),
                }).then((r) => r.json());
                resolve(accessToken);
            }
            if (status === 'expired') {
                clearInterval(timer);
                reject(new Error('二维码已过期,请刷新重试'));
            }
        }, 2000);
    });
}

function renderQrImage(url: string) {
    console.log('渲染二维码:', url); // 生产用 qrcode 库生成
}

// 手机扫码 → App 内确认 → 浏览器轮询到 confirmed → 免密登录完成
