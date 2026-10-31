// 文件: examples/40-03-upload-queue.ts
// ============ 上传队列：暂停 / 恢复 / 取消 / 进度聚合 ============
// 多文件上传是一个调度问题：并发上限、优先级（小文件先完成改善体感）、
// 暂停/恢复/取消、整体进度 = 各文件进度的加权和（按字节而非按文件数）。
// 队列状态机：waiting → uploading → done | paused | canceled | failed。
// 关键点：暂停 = 停止取新任务 + 已开始分片保留账本（续传）；取消 = 清理账本 + 通知服务端作废。

export type TaskStatus =
  | "waiting"
  | "uploading"
  | "paused"
  | "done"
  | "canceled"
  | "failed";

export interface UploadTask {
  id: string;
  name: string;
  size: number; // 字节
  uploaded: number; // 已传字节
  status: TaskStatus;
  priority: number; // 小者先
}

export class UploadQueue {
  private tasks: UploadTask[] = [];
  readonly events: string[] = [];

  constructor(private concurrency = 2) {}

  add(name: string, size: number, priority = 0): UploadTask {
    const task: UploadTask = {
      id: `t${this.tasks.length + 1}`,
      name,
      size,
      uploaded: 0,
      status: "waiting",
      priority,
    };
    this.tasks.push(task);
    this.events.push(`+ 加入: ${name}`);
    return task;
  }

  /** 调度一轮：按优先级挑 waiting 任务填满并发窗口（模拟驱动，非真实 IO） */
  tick(bytesPerTick: number): void {
    const active = this.tasks.filter((t) => t.status === "uploading");
    const slots = this.concurrency - active.length;
    const candidates = this.tasks
      .filter((t) => t.status === "waiting")
      .sort((a, b) => a.priority - b.priority || a.size - b.size)
      .slice(0, Math.max(0, slots));
    for (const t of candidates) {
      t.status = "uploading";
      this.events.push(`▶ 开始: ${t.name}`);
    }
    // 模拟每个活动任务推进 bytesPerTick
    for (const t of this.tasks.filter((x) => x.status === "uploading")) {
      t.uploaded = Math.min(t.size, t.uploaded + bytesPerTick);
      if (t.uploaded >= t.size) {
        t.status = "done";
        this.events.push(`✓ 完成: ${t.name}`);
      }
    }
  }

  pause(id: string): void {
    const t = this.find(id);
    if (t.status === "uploading" || t.status === "waiting") {
      t.status = "paused"; // 已传分片账本保留，恢复后续传
      this.events.push(
        `⏸ 暂停: ${t.name}（已传 ${((t.uploaded / t.size) * 100).toFixed(0)}% 保留）`,
      );
    }
  }

  resume(id: string): void {
    const t = this.find(id);
    if (t.status === "paused") {
      t.status = "waiting";
      this.events.push(`⏵ 恢复: ${t.name}（从已传位置续传）`);
    }
  }

  cancel(id: string): void {
    const t = this.find(id);
    if (t.status !== "done") {
      t.status = "canceled";
      t.uploaded = 0;
      this.events.push(`✕ 取消: ${t.name}（通知服务端作废分片账本）`);
    }
  }

  /** 整体进度：按字节加权和，被取消/失败的文件不计入分母 */
  overallProgress(): number {
    const active = this.tasks.filter((t) => t.status !== "canceled");
    if (active.length === 0) return 100;
    const total = active.reduce((s, t) => s + t.size, 0);
    const uploaded = active.reduce((s, t) => s + t.uploaded, 0);
    return (uploaded / total) * 100;
  }

  private find(id: string): UploadTask {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) throw new Error(`task not found: ${id}`);
    return t;
  }

  snapshot(): Array<Pick<UploadTask, "name" | "status" | "uploaded" | "size">> {
    return this.tasks.map(({ name, status, uploaded, size }) => ({
      name,
      status,
      uploaded,
      size,
    }));
  }
}

// ---------------- 验证 ----------------

const q = new UploadQueue(2);
// 优先级：小文件先传（改善整体完成感）
q.add("头像.png", 100, 1);
q.add("需求文档.pdf", 300, 1);
q.add("视频.mp4", 900, 2);

console.log("=== 调度：并发 2，小文件优先 ===");
q.tick(100);
console.log(q.snapshot());

console.log("\n=== 暂停大文件 → 让位 ===");
q.pause("t3");
q.tick(100);
console.log(q.snapshot());

console.log("\n=== 恢复续传 ===");
q.resume("t3");
for (let i = 0; i < 10; i++) q.tick(100);
console.log(q.snapshot());
console.log("整体进度:", q.overallProgress().toFixed(1) + "%");

console.log("\n=== 取消：不计入分母 ===");
q.cancel("t3");
console.log("取消后整体进度:", q.overallProgress().toFixed(1) + "%");
console.log("\n事件流:");
for (const e of q.events) console.log(" ", e);
