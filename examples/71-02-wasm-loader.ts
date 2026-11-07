// 文件: examples/71-02-wasm-loader.ts

/**
 * 生产级 WASM 加载器（状态机模拟，无需真实 .wasm 产物）
 *
 * 真实浏览器里的加载链路是四层降级：
 *   特性探测 → instantiateStreaming 流式编译 → instantiate 普通编译 → JS 降级实现
 * 任何一层失败都不能让页面白屏——状态机保证「要么 ready，要么 downgraded，要么 failed」，
 * 绝不卡在中间态。本示例用可注入的 mock 环境演示三条路径：成功 / 降级 / 报错。
 */

/** 加载器状态：终态只有 ready / downgraded / failed 三个 */
type LoaderState =
  | "idle"
  | "probing" // 特性探测中
  | "compiling" // 流式/普通编译中
  | "instantiating" // 实例化中
  | "ready" // WASM 可用
  | "downgraded" // WASM 不可用，已切换 JS 实现
  | "failed"; // WASM 与 JS 实现都不可用

/** 可注入的环境能力（真实代码里对应 WebAssembly.* 探测） */
interface WasmEnv {
  hasWebAssembly: boolean;
  /** 是否支持 instantiateStreaming（需要正确的 MIME: application/wasm） */
  hasStreaming: boolean;
  /** 模拟编译阶段是否抛错（网络 404、MIME 错误、产物损坏都会走到这） */
  compileFails: boolean;
}

/** 计算模块抽象：WASM 与 JS 实现都实现同一接口，业务无感 */
interface ComputeModule {
  kind: "wasm" | "js";
  hash(data: Uint8Array): number;
}

interface LoadResult {
  state: LoaderState;
  module: ComputeModule | null;
  /** 状态迁移轨迹，用于监控上报与排障 */
  trace: LoaderState[];
  error?: string;
}

class WasmLoader {
  private state: LoaderState = "idle";
  private trace: LoaderState[] = ["idle"];

  constructor(
    private env: WasmEnv,
    private jsFallback: ComputeModule | null,
  ) {}

  private transit(next: LoaderState) {
    this.state = next;
    this.trace.push(next);
  }

  /** 模拟流式编译：边下载边编译，首字节到达后即开始 */
  private async compileStreaming(): Promise<ArrayBuffer> {
    if (!this.env.hasStreaming) throw new Error("streaming 不可用");
    if (this.env.compileFails) throw new Error("MIME 类型错误");
    return new ArrayBuffer(8); // 假装是编译好的模块
  }

  /** 模拟普通编译：先完整下载再 compile，兼容老链路 */
  private async compileBuffered(): Promise<ArrayBuffer> {
    if (this.env.compileFails) throw new Error("产物损坏");
    return new ArrayBuffer(8);
  }

  async load(): Promise<LoadResult> {
    // 第一层：特性探测——连 WebAssembly 对象都没有，直接降级
    this.transit("probing");
    if (!this.env.hasWebAssembly) {
      return this.downgrade("当前环境不支持 WebAssembly");
    }

    // 第二层：流式编译优先，失败后回退普通编译
    this.transit("compiling");
    let compiled: ArrayBuffer;
    try {
      compiled = await this.compileStreaming();
    } catch {
      try {
        compiled = await this.compileBuffered();
      } catch (e) {
        return this.downgrade(`WASM 编译失败：${(e as Error).message}`);
      }
    }

    // 第三层：实例化（真实代码里还要注入 importObject 与 memory）
    this.transit("instantiating");
    if (compiled.byteLength === 0) {
      return this.downgrade("实例化失败：空模块");
    }
    const wasmModule: ComputeModule = {
      kind: "wasm",
      hash: (data) => data.reduce((acc, b) => (acc * 31 + b) >>> 0, 7),
    };
    this.transit("ready");
    return { state: this.state, module: wasmModule, trace: this.trace };
  }

  /** 统一降级出口：有 JS 实现则降级，没有则报错终止 */
  private downgrade(reason: string): LoadResult {
    if (this.jsFallback) {
      this.transit("downgraded");
      console.warn(`  [loader] ${reason}，已切换 JS 降级实现`);
      return {
        state: this.state,
        module: this.jsFallback,
        trace: this.trace,
        error: reason,
      };
    }
    this.transit("failed");
    return {
      state: this.state,
      module: null,
      trace: this.trace,
      error: `${reason}，且无 JS 降级实现`,
    };
  }
}

/** ============ 三条路径演示 ============ */
export async function runLoaderDemo() {
  const jsImpl: ComputeModule = {
    kind: "js",
    hash: (data) => data.reduce((acc, b) => (acc * 31 + b) >>> 0, 7),
  };
  const sample = new Uint8Array([1, 2, 3, 4]);

  // 路径 1：流式编译成功——理想链路
  const ok = await new WasmLoader(
    { hasWebAssembly: true, hasStreaming: true, compileFails: false },
    jsImpl,
  ).load();
  console.log(`路径1 成功：状态=${ok.state} 实现=${ok.module?.kind}`);
  console.log(`  状态轨迹：${ok.trace.join(" → ")}`);

  // 路径 2：WASM 编译失败 → JS 降级——页面不炸，功能可用
  const degraded = await new WasmLoader(
    { hasWebAssembly: true, hasStreaming: true, compileFails: true },
    jsImpl,
  ).load();
  console.log(`路径2 降级：状态=${degraded.state} 实现=${degraded.module?.kind}`);
  console.log(`  状态轨迹：${degraded.trace.join(" → ")}`);

  // 路径 3：WASM 不可用且没有 JS 兜底——明确报错，不白屏
  const failed = await new WasmLoader(
    { hasWebAssembly: false, hasStreaming: false, compileFails: true },
    null,
  ).load();
  console.log(`路径3 报错：状态=${failed.state} 原因=${failed.error}`);

  // ---- 断言 ----
  console.assert(ok.state === "ready" && ok.module?.kind === "wasm", "路径1 应就绪");
  console.assert(
    ok.trace.join() === "idle,probing,compiling,instantiating,ready",
    "路径1 应走完整成功链路",
  );
  console.assert(
    degraded.state === "downgraded" && degraded.module?.kind === "js",
    "路径2 应降级到 JS",
  );
  console.assert(failed.state === "failed" && failed.module === null, "路径3 应失败");
  // 同一输入下两种实现结果必须一致——降级不能改变业务语义
  console.assert(
    ok.module!.hash(sample) === degraded.module!.hash(sample),
    "WASM 与 JS 实现的结果必须一致",
  );

  console.log("\n✅ WASM 加载器三路径演示通过");
}

runLoaderDemo();
