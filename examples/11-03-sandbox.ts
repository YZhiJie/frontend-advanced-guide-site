// 文件: examples/11-03-sandbox.ts —— 简易 JS 沙箱:理解 qiankun 的核心机制
// ============ Proxy 沙箱:子应用的所有 window 操作被劫持到假 window 上 ============

function createSandbox() {
    const fakeWindow: Record<PropertyKey, unknown> = {};
    const sandbox = new Proxy(fakeWindow, {
        get(target, key) {
            // 子应用代码里的 window/self 应指向沙箱自身,嵌套取值才能继续走代理
            if (key === 'window' || key === 'self' || key === 'globalThis') return sandbox;
            // 先查子应用自己的命名空间,没有再回退到真实全局(只读共享)
            return key in target ? target[key] : (globalThis as any)[key];
        },
        set(target, key, value) {
            target[key] = value; // 写操作只落在沙箱里,不污染全局
            return true;
        },
        has(target, key) {
            return true; // 让 `xxx in window` 判断始终成立,兼容各种环境嗅探代码
        },
    });
    return sandbox;
}

// 用 Function 构造器把子应用代码跑在沙箱 window 中(与 qiankun 的 with/Proxy 方案同思路)
function runInSandbox(code: string) {
    const sandbox = createSandbox();
    // with(window){...}:子应用代码中的所有全局引用都会先经过沙箱代理
    const fn = new Function('window', 'self', `with (window) {\n${code}\n}`);
    fn(sandbox, sandbox);
    return sandbox;
}

// 演示:两个"子应用"互不污染
const app1 = runInSandbox(`
    var config = { theme: 'dark' }; // 不小心没写 let/var 也不会泄漏到真全局(有 with 代理时)
    window.counter = 1;
`);
const app2 = runInSandbox(`
    window.counter = 999;
`);
console.log((app1 as any).counter); // 1 —— 不受 app2 影响
console.log((app2 as any).counter); // 999
console.log((window as any).counter); // undefined —— 真实 window 未被污染

// 主应用侧的聚合(qiankun 用法示意):
// import { registerMicroApps, start } from 'qiankun';
// registerMicroApps([
//     { name: 'react-app', entry: '//localhost:7001', container: '#sub-container', activeRule: '/react' },
//     { name: 'vue-app', entry: '//localhost:7002', container: '#sub-container', activeRule: '/vue' },
// ]);
// start({ prefetch: true });
export {};
