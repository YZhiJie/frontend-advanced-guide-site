// 文件: examples/08-01-jsbridge.ts —— [浏览器] 手写一个 Promise 化的 JSBridge
// ============ H5 侧完整实现:调用、回调分发、超时兜底 ============

interface NativeMessage { method: string; params: Record<string, unknown>; callbackId: string }
type Callback = (data: { ok: boolean; data?: unknown; error?: string }) => void;

const pendingCallbacks = new Map<string, Callback>();
let seed = 0;

/** H5 → Native:所有调用 Promise 化 */
function callNative<T>(method: string, params: Record<string, unknown> = {}, timeout = 10_000): Promise<T> {
    return new Promise((resolve, reject) => {
        const callbackId = `cb_${Date.now()}_${seed++}`;
        const timer = setTimeout(() => {
            pendingCallbacks.delete(callbackId);
            reject(new Error(`JSBridge 调用超时: ${method}`));
        }, timeout);

        pendingCallbacks.set(callbackId, (result) => {
            clearTimeout(timer);
            result.ok ? resolve(result.data as T) : reject(new Error(result.error));
        });

        // 通过 Native 注入的对象发送(iOS: window.webkit.messageHandlers.bridge.postMessage)
        const bridge = (window as any).NativeBridge;
        if (!bridge?.postMessage) return reject(new Error('Bridge 未注入(是否运行在 App 内?)'));
        bridge.postMessage(JSON.stringify({ method, params, callbackId } satisfies NativeMessage));
    });
}

// Native 处理完毕后,调用 window.__handleNativeResponse 回传(由 Native 侧 evaluateJavascript 触发)
// 对应 Native 伪代码:
//   webView.evaluateJavascript("window.__handleNativeResponse('cb_1', {ok:true, data:{...}})")
(window as any).__handleNativeResponse = (callbackId: string, result: { ok: boolean; data?: unknown; error?: string }) => {
    pendingCallbacks.get(callbackId)?.(result);
    pendingCallbacks.delete(callbackId);
};

// ---- 业务封装:具体能力收敛成语义化 API ----
export const bridge = {
    scanCode: () => callNative<string>('scanCode'),
    getLocation: () => callNative<{ lat: number; lng: number }>('getLocation'),
    setTitle: (title: string) => callNative<void>('setTitle', { title }),
};

// 使用:
// const { lat, lng } = await bridge.getLocation();
export {};
