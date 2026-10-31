// 文件: examples/40-01-chunk-upload.ts
// ============ 分片上传：切片 + 并发窗口 + 重试 ============
// 大文件（如 2GB）不能一次请求传完：超时、内存、弱网断线都扛不住。
// 分片上传三要素：
// 1) 切片：File.slice(start, end) 按固定大小切（如 5MB）；
// 2) 并发窗口：同时只传 N 片（如 3），完成一片补一片——并发太大挤占带宽还易触发网关限流；
// 3) 单片重试：失败片指数退避重试，全部片成功后调 merge 合并接口。
// 本示例用确定性伪网络模拟，无真实 IO，可重复运行。

export interface ChunkTask {
  index: number;
  start: number;
  end: number;
  /** 上传状态 */
  status: "pending" | "uploading" | "done" | "failed";
  attempts: number;
}

export interface UploadPlan {
  fileSize: number;
  chunkSize: number;
  chunks: ChunkTask[];
}

/** 生成上传计划：切片清单 */
export function planChunks(fileSize: number, chunkSize: number): UploadPlan {
  const count = Math.ceil(fileSize / chunkSize);
  const chunks: ChunkTask[] = [];
  for (let i = 0; i < count; i++) {
    chunks.push({
      index: i,
      start: i * chunkSize,
      end: Math.min((i + 1) * chunkSize, fileSize),
      status: "pending",
      attempts: 0,
    });
  }
  return { fileSize, chunkSize, chunks };
}

/** 伪网络：按分片序号预置失败表（true = 该片第一次会失败） */
export interface FakeNetwork {
  /** index → 失败次数（前 N 次失败后成功） */
  failTimes: Map<number, number>;
}

function sendChunk(net: FakeNetwork, chunk: ChunkTask): { ok: boolean } {
  const fails = net.failTimes.get(chunk.index) ?? 0;
  if (chunk.attempts <= fails) return { ok: false };
  return { ok: true };
}

/**
 * 并发窗口上传：同时最多 concurrency 片，完成即补位；单片最多 maxRetries 次重试。
 * 返回进度轨迹与最终状态。
 */
export async function uploadWithWindow(
  plan: UploadPlan,
  net: FakeNetwork,
  concurrency = 3,
  maxRetries = 3,
): Promise<{
  ok: boolean;
  doneChunks: number;
  failedChunks: number[];
  timeline: string[];
}> {
  const timeline: string[] = [];
  let nextIndex = 0;
  let done = 0;
  const failedChunks: number[] = [];

  const worker = async (): Promise<void> => {
    while (nextIndex < plan.chunks.length) {
      const chunk = plan.chunks[nextIndex++];
      chunk.status = "uploading";
      // 重试循环（指数退避演示用固定短延迟）
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        chunk.attempts = attempt;
        const { ok } = sendChunk(net, chunk);
        if (ok) {
          chunk.status = "done";
          done++;
          timeline.push(
            `片${chunk.index} 完成(第${attempt}次尝试) ${done}/${plan.chunks.length}`,
          );
          break;
        }
        if (attempt === maxRetries) {
          chunk.status = "failed";
          failedChunks.push(chunk.index);
          timeline.push(`片${chunk.index} 重试${maxRetries}次仍失败`);
        }
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return {
    ok: failedChunks.length === 0,
    doneChunks: done,
    failedChunks,
    timeline,
  };
}

// ---------------- 验证 ----------------

const fileSize = 26 * 1024 * 1024; // 26MB
const chunkSize = 5 * 1024 * 1024; // 5MB → 6 片
const plan = planChunks(fileSize, chunkSize);
console.log("=== 上传计划 ===");
console.log(
  `文件 ${fileSize / 1024 / 1024}MB / 片 ${chunkSize / 1024 / 1024}MB → ${plan.chunks.length} 片`,
);
console.log(
  "切片区间:",
  plan.chunks.map((c) => `[${c.start},${c.end})`).join(" "),
);

console.log("\n=== 并发窗口 3，片2 连挂 2 次、片4 连挂 3 次 ===");
const result = await uploadWithWindow(
  plan,
  {
    failTimes: new Map([
      [2, 2],
      [4, 3],
    ]),
  },
  3,
  3,
);
console.log(
  "最终:",
  result.ok ? "全部成功" : "存在失败片",
  `完成 ${result.doneChunks}/${plan.chunks.length}`,
);
console.log(
  "失败片:",
  result.failedChunks.length === 0 ? "无" : result.failedChunks,
);
console.log("轨迹（前 8 条）:");
for (const t of result.timeline.slice(0, 8)) console.log(" ", t);

console.log("\n=== 对应浏览器 API（示意） ===");
console.log(`
// 真实上传体：await file.slice(chunk.start, chunk.end) → FormData → fetch
// File.slice 返回 Blob，不读进内存——2GB 文件也只占 5MB 内存/片`);
