// 文件: examples/17-16-wasm-worker-side.ts —— [浏览器] Worker 侧:加载 WASM 并处理
// ============ Worker 线程:加载 WASM,接收数据,返回结果 ============

// import { instantiate } from '@assemblyscript/loader';
// 或:import init from './pkg/blur.js'; // wasm-bindgen/wasm-pack 生成

let wasmExports: { blur: (ptr: number, width: number, height: number, radius: number) => void; memory: WebAssembly.Memory } | null = null;

async function initWasm() {
    if (wasmExports) return;
    // AssemblyScript 产出:.wasm + .js 胶水层
    // Rust(wasm-pack) 产出:pkg/*.wasm + *.js(含 wasm-bindgen 胶水)
    // const wasm = await instantiate(fetch('/blur.wasm'), {});
    // wasmExports = wasm.exports as typeof wasmExports;
}

self.onmessage = async (e: MessageEvent) => {
    await initWasm();
    const { type, data, width, height, radius } = e.data;
    if (type !== 'blur') return;

    const pixels = new Uint8ClampedArray(data); // 接收主线程传来的 buffer

    // ---- 线性内存交互:把 JS 数据写入 WASM 内存 ----
    // 1. 分配 WASM 内存空间(大小 = width * height * 4 RGBA)
    const ptr = 0; // wasmExports!.alloc(pixels.length); // 分配指针
    // 2. 把像素数据复制到 WASM 线性内存
    const wasmMem = new Uint8ClampedArray(/* wasmExports!.memory.buffer */ data);
    wasmMem.set(pixels, ptr);
    // 3. 调用 WASM 函数(同步,但 Worker 中不阻塞 UI)
    // wasmExports!.blur(ptr, width, height, radius);
    // 4. 从 WASM 内存读回结果
    const result = wasmMem.slice(ptr, ptr + pixels.length);
    // 5. 释放 WASM 内存
    // wasmExports!.dealloc(ptr, pixels.length);

    // ⚠️ 第 2 步和第 4 步是"边界穿越" —— 每次拷贝都有开销
    // ✅ 优化方向:批量传递、减少调用次数(一次处理整帧而非逐像素)

    // Transferable 回传结果(零拷贝)
    self.postMessage(
        { type: 'result', data: result.buffer, width, height },
        [result.buffer],
    );
};

export {};
