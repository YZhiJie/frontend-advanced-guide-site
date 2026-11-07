// 文件: examples/17-06-wasm-boundary.ts —— WASM 的取舍判断(概念示意)
// 场景 A ✅:JS 里做高斯模糊(百万像素 × 卷积核)—— 纯计算,单帧内完成,WASM 快 5~20 倍
// 场景 B ❌:用 WASM 遍历 DOM 生成列表 —— 每次操作 DOM 都要跨越 JS↔WASM 边界,反而更慢

// 加载与实例化(以导出 blur 函数的 wasm 模块为例):
// const { instance } = await WebAssembly.instantiateStreaming(
//     fetch('/blur.wasm'),
//     { env: { memory: new WebAssembly.Memory({ initial: 256 }) } },
// );
// instance.exports.blur(imageDataPtr, width, height, radius);
// 💡 数据通过线性内存传递:把像素写入 WASM 内存 → 调用 → 读回,边界穿越次数要最小化

// 决策自检三问:
// 1. 热点真的是计算吗?(先 profiling,呼应 10.3 —— 很多"慢"是 DOM/布局,不是算力)
// 2. 该算法有现成的 C/C++/Rust 实现吗?(有 → 复用生态;没有 → 手写 Rust 成本可能不值)
// 3. 能接受 +几百 KB 的 wasm 产物吗?(移动端弱网要权衡)
export {};
