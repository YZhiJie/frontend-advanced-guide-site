// 文件: examples/17-17-assemblyscript.ts —— AssemblyScript 源码(编译为 .wasm)
// @ts-nocheck —— AssemblyScript 是 TS 子集,需用 asc 编译(usize/i32/load/store 非 TS 标准),故跳过 tsc
// npm i -g assemblyscript
// asc 17-17-assemblyscript.ts --outFile blur.wasm --exportRuntime
// ============ 用 TypeScript 语法写,编译为 WASM 二进制 ============

// AssemblyScript 是 TypeScript 的子集(严格类型,无 any/union)
// 导出的函数可被 JS 调用

// @ts-ignore: AssemblyScript 的整数类型标注
export function blur(
  srcPtr: usize,
  width: i32,
  height: i32,
  radius: i32,
): void {
  // 直接操作线性内存(指针 = 内存偏移量)
  // AssemblyScript 提供了 load/store 函数操作内存
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 简化:实际高斯模糊需要卷积核邻域采样
      const offset = (y * width + x) * 4;
      const r = load<u8>(srcPtr + offset);
      const g = load<u8>(srcPtr + offset + 1);
      const b = load<u8>(srcPtr + offset + 2);
      // 简化处理:实际应对邻域求均值
      store<u8>(srcPtr + offset, r);
      store<u8>(srcPtr + offset + 1, g);
      store<u8>(srcPtr + offset + 2, b);
    }
  }
}

// ---- 与 Rust(wasm-pack)的对比 ----
// | 维度 | AssemblyScript | Rust + wasm-pack |
// | ---- | -------------- | ---------------- |
// | 语言 | TypeScript 子集(上手快) | Rust(学习曲线陡) |
// | 性能 | 接近原生(略慢于 Rust) | 最优(与 C 持平) |
// | 生态 | 小(适合简单计算) | 大(可复用 crates.io) |
// | 胶水 | 自动生成 JS 绑定 | wasm-bindgen 自动生成 |
// | 适用 | 快速原型/简单算法 | 生产级/复杂算法/复用现有 C/Rust 库 |

export {};
