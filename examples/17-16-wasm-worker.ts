// 文件: examples/17-16-wasm-worker.ts —— [浏览器] WASM 在 Worker 中运行
// ============ 主线程:发送数据给 Worker,接收处理结果 ============

// 主线程
const worker = new Worker(
  new URL("./17-16-wasm-worker-side.ts", import.meta.url),
  { type: "module" },
);

interface WasmResult {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

async function blurImage(
  imageData: ImageData,
  radius: number,
): Promise<ImageData> {
  // 用 Transferable 零拷贝传递 ArrayBuffer(发送方立即失去访问权)
  const buf = imageData.data.buffer;
  const promise = new Promise<ImageData>((resolve) => {
    worker.onmessage = (e: MessageEvent) => {
      const result = e.data as WasmResult;
      // ⚠️ TS 严格模式下 Uint8ClampedArray 的 backing buffer 类型可能是 SharedArrayBuffer
      // 此处用类型断言绕过 ImageData 构造器的重载冲突,运行时 buffer 必为 ArrayBuffer
      resolve(
        new ImageData(
          result.data as unknown as Uint8ClampedArray<ArrayBuffer>,
          result.width,
          result.height,
        ),
      );
    };
  });
  // ⚠️ Transferable 传递后,原 imageData.data 的 buffer 被 detached,不能再访问
  worker.postMessage(
    {
      type: "blur",
      data: buf,
      width: imageData.width,
      height: imageData.height,
      radius,
    },
    [buf],
  );
  return promise;
}

// ⚠️ Worker + WASM 组合的典型场景:实时视频滤镜(每帧送入 WASM 处理)
// requestVideoFrameCallback + WASM blur → 实时滤镜不卡 UI

export {};
