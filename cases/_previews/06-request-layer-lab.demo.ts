// 06-request-layer-lab 在线预览：TTL 缓存 / 并发去重 / 重试退避 / 超时取消（fetcher 全 mock，不发真实请求）
import { createClient } from "../06-request-layer-lab/src/request.ts";
import { fullJitterDelay } from "../06-request-layer-lab/src/backoff.ts";
import { section, button, buttonRow, output, log, table } from "./shared.ts";

const sec = section(
  "请求层实验室",
  "fetcher 是内存 mock：可切换「稳定 / 恶劣（前 2 次必失败）」模式，全程离线",
);
const out = output(sec);

let mode: "stable" | "flaky" = "stable";
let fetchCalls = 0;
const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, Math.min(ms, 400)));

function makeClient() {
  fetchCalls = 0;
  return createClient<string>({
    fetcher: async (key) => {
      fetchCalls++;
      log(out, `→ fetcher(${key}) 第 ${fetchCalls} 次真实调用`, "info");
      if (mode === "flaky" && fetchCalls <= 2)
        throw new Error(`mock 网络错误 #${fetchCalls}`);
      return `resp(${key})@${fetchCalls}`;
    },
    ttl: 5000,
    retries: 2,
    baseDelay: 60,
    maxDelay: 300,
    sleep,
  });
}

const row = buttonRow(sec);
let client = makeClient();

button(row, "① TTL 缓存：同一 key 连发 2 次", async () => {
  client = makeClient();
  const a = await client.request("user/1");
  const b = await client.request("user/1");
  log(out, `结果：${a} / ${b}`, "ok");
  table(out, [
    ["fetcher 实际调用次数（应为 1）", fetchCalls],
    ["缓存条目 size", client.size],
  ]);
});

button(row, "② 并发去重：同时发 3 个同 key", async () => {
  client = makeClient();
  const rs = await Promise.all([
    client.request("list"),
    client.request("list"),
    client.request("list"),
  ]);
  log(out, `结果：${rs.join(" | ")}`, "ok");
  table(out, [
    ["fetcher 实际调用次数（应为 1）", fetchCalls],
    ["in-flight 峰值后剩余 pending", client.pending],
  ]);
});

button(row, "③ 重试退避：恶劣模式（前 2 次失败）", async () => {
  mode = "flaky";
  client = makeClient();
  try {
    const r = await client.request("flaky-api");
    log(out, `最终成功：${r}（重试 2 次后第 3 次成功）`, "ok");
  } finally {
    mode = "stable";
  }
});

button(row, "④ 竞态：旧 key 结果不会覆盖新 key", async () => {
  client = makeClient();
  const p1 = client.request("slow");
  const p2 = client.request("fast");
  const [a, b] = await Promise.all([p1, p2]);
  log(out, `slow → ${a}`, "dim");
  log(out, `fast → ${b}（各自 key 独立缓存，互不覆盖）`, "ok");
  table(out, [
    ["fetcher 调用次数", fetchCalls],
    ["缓存条目", client.size],
  ]);
});

button(row, "🎲 full-jitter 延迟序列（attempt 1..5）", () => {
  const random = Math.random;
  for (let a = 1; a <= 5; a++) {
    const vals = Array.from({ length: 5 }, () =>
      fullJitterDelay(a, { baseDelay: 100, maxDelay: 3200, random }),
    );
    log(out, `attempt ${a}：${vals.map((v) => `${v}ms`).join(" / ")}`, "dim");
  }
  log(
    out,
    "观察：单次尝试的延迟随机抖动，但随 attempt 指数抬升、且不超过 maxDelay",
    "info",
  );
});
