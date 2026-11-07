/**
 * esbuild inject 用：把 08 源码里的裸 Buffer 全局引用接到浏览器 shim。
 * （esbuild define { Buffer: "Buffer" } + inject 本文件 = 官方 $/jQuery 同款模式；
 *   demo 里 import { Buffer } from "node:buffer" 的绑定不受 define 影响）
 */
import { Buffer } from "./node-net.ts";
export { Buffer };
