// 文件: examples/18-04-service-worker/app.js
// 页面侧：注册 SW、展示状态、处理更新提示、发演示请求。

const out = document.querySelector('#out');
const statusEl = document.querySelector('#status');
function log(...args) {
    out.textContent += '\n' + args.join(' ');
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const reg = await navigator.serviceWorker.register('./sw.js');
            statusEl.textContent = `已注册，scope: ${reg.scope}`;
            log('✅ SW 注册成功');
            watchUpdate(reg);
        } catch (err) {
            statusEl.textContent = '注册失败（需 HTTP/HTTPS 环境，file:// 不可用）';
            log('❌ 注册失败:', err.message);
        }
    });

    // 新 SW 接管后刷新一次，保证页面与缓存版本一致
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        location.reload();
    });
}

// 标准更新检测流程：updatefound → 新 SW installed（且已有 controller）→ 提示用户
function watchUpdate(reg) {
    function promptIfWaiting(worker) {
        if (worker) {
            document.querySelector('#toast').style.display = 'block';
            document.querySelector('#reload').onclick = () => worker.postMessage('SKIP_WAITING');
        }
    }

    reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
            if (nw.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                    promptIfWaiting(nw); // 老页面 + 新版本
                } else {
                    log('ℹ️ 首次安装完成，下次加载起受控');
                }
            }
        });
    });

    document.querySelector('#checkUpdate').onclick = () => reg.update();
}

document.querySelector('#fetchData').addEventListener('click', async () => {
    try {
        const res = await fetch('./data.json', { cache: 'no-store' });
        const data = await res.json();
        log('📦 data.json =>', JSON.stringify(data));
    } catch (err) {
        log('❌ 请求失败（离线时符合预期）:', err.message);
    }
});

document.querySelector('#unregister').addEventListener('click', async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg?.unregister();
    log('⚠️ SW 已注销，刷新后不再受控（缓存仍在，可在 Application → Clear storage 清空）');
});
