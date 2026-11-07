// 文件: examples/70-02-update-state-machine.ts —— 桌面端自动更新状态机：灰度门控 + 签名校验 + 失败回滚

import { createHash, createHmac } from "node:crypto";

/** 更新状态机的全部状态 */
type UpdateState =
  | "idle" // 空闲
  | "checking" // 检查更新
  | "downloading" // 下载中
  | "verifying" // 校验签名中
  | "ready" // 就绪待应用
  | "applying" // 应用中
  | "done" // 完成
  | "failed" // 失败（待回滚）
  | "rolled-back"; // 已回滚

/** 更新服务器下发的清单（对应 Tauri updater 的 latest.json） */
interface UpdateManifest {
  version: string;
  rolloutPercent: number; // 灰度比例 0~100
  sha256: string; // 安装包完整性摘要
  signature: string; // 签名（真实环境是 minisign/ed25519，这里用 HMAC 模拟）
}

/** 合法的状态迁移表：状态机的价值就在于「非法迁移直接拒绝」 */
const TRANSITIONS: Record<UpdateState, UpdateState[]> = {
  idle: ["checking"],
  checking: ["idle", "downloading"], // 无更新/灰度未命中 → 回 idle；有更新 → 下载
  downloading: ["verifying", "failed"],
  verifying: ["ready", "failed"],
  ready: ["applying", "idle"], // 用户选择稍后 → 回 idle
  applying: ["done", "failed"],
  failed: ["rolled-back"],
  "rolled-back": ["idle"],
  done: [],
};

class UpdateError extends Error {}

class UpdateMachine {
  state: UpdateState = "idle";
  readonly log: string[] = [];

  private transit(to: UpdateState, reason: string) {
    const allowed = TRANSITIONS[this.state];
    if (!allowed.includes(to)) {
      throw new UpdateError(`非法迁移: ${this.state} → ${to}`);
    }
    this.log.push(`${this.state} → ${to}（${reason}）`);
    this.state = to;
  }

  /** 灰度门控：同一台设备的判定结果必须稳定，不能每次检查都摇骰子 */
  static inRollout(deviceId: string, percent: number): boolean {
    const hash = createHash("md5").update(deviceId).digest();
    return hash[0] % 100 < percent; // 取首字节做 0~99 的稳定分桶
  }

  /** 验签：真实环境用 minisign 公钥，这里用 HMAC 共享密钥模拟「私钥签名、公钥（内置密钥）验签」 */
  static verifySignature(payload: Buffer, signature: string, publicKey: string): boolean {
    const expect = createHmac("sha256", publicKey).update(payload).digest("hex");
    return expect === signature;
  }

  /** 模拟一次完整的更新检查流程 */
  run(opts: {
    deviceId: string;
    currentVersion: string;
    manifest: UpdateManifest | null; // null 表示服务器无更新
    downloadedPayload: Buffer; // 实际下载到的字节（可能被篡改）
    publicKey: string;
  }): UpdateState {
    const { deviceId, currentVersion, manifest, downloadedPayload, publicKey } = opts;
    this.transit("checking", "启动定时检查");

    if (!manifest || manifest.version <= currentVersion) {
      this.transit("idle", "已是最新版本");
      return this.state;
    }
    if (!UpdateMachine.inRollout(deviceId, manifest.rolloutPercent)) {
      this.transit("idle", `灰度 ${manifest.rolloutPercent}% 未命中本设备`);
      return this.state;
    }

    this.transit("downloading", `发现新版本 ${manifest.version}`);
    this.transit("verifying", "下载完成，开始校验");

    const digest = createHash("sha256").update(downloadedPayload).digest("hex");
    const integrityOk = digest === manifest.sha256;
    const signatureOk = UpdateMachine.verifySignature(
      downloadedPayload,
      manifest.signature,
      publicKey,
    );
    if (!integrityOk || !signatureOk) {
      this.transit("failed", !integrityOk ? "完整性摘要不一致" : "签名校验失败");
      this.transit("rolled-back", "丢弃安装包，保留旧版本");
      this.transit("idle", "回滚完成，等待下个检查周期");
      return this.state;
    }

    this.transit("ready", "校验通过，等待应用");
    this.transit("applying", "用户确认，应用更新");
    this.transit("done", `已更新到 ${manifest.version}`);
    return this.state;
  }
}

/** ============ 四个场景演示 ============ */
export function runUpdateDemo() {
  const publicKey = "pub-key-built-into-app"; // 内置在客户端里的验签密钥
  const signKey = publicKey; // 模拟环境：签名/验签同钥；真实 minisign 是私钥签、公钥验
  const goodPayload = Buffer.from("fake-installer-v2.4.0-bytes");
  const sign = (payload: Buffer) =>
    createHmac("sha256", signKey).update(payload).digest("hex");
  const makeManifest = (payload: Buffer, rollout = 100): UpdateManifest => ({
    version: "2.4.0",
    rolloutPercent: rollout,
    sha256: createHash("sha256").update(payload).digest("hex"),
    signature: sign(payload),
  });

  // 场景 1：正常全流程 idle→…→done
  const m1 = new UpdateMachine();
  const s1 = m1.run({
    deviceId: "device-001",
    currentVersion: "2.3.0",
    manifest: makeManifest(goodPayload),
    downloadedPayload: goodPayload,
    publicKey,
  });
  console.log("场景 1 迁移轨迹：");
  m1.log.forEach((l) => console.log(`  ${l}`));
  console.assert(s1 === "done", `场景 1 终态应为 done，实际 ${s1}`);

  // 场景 2：下载字节被篡改 → 验签失败 → 回滚
  const tampered = Buffer.from("evil-installer-bytes");
  const m2 = new UpdateMachine();
  const s2 = m2.run({
    deviceId: "device-002",
    currentVersion: "2.3.0",
    manifest: makeManifest(goodPayload), // 清单是真的，包是假的
    downloadedPayload: tampered,
    publicKey,
  });
  console.log("场景 2 迁移轨迹：");
  m2.log.forEach((l) => console.log(`  ${l}`));
  console.assert(s2 === "idle", `场景 2 终态应为 idle（已回滚），实际 ${s2}`);
  console.assert(
    m2.log.some((l) => l.includes("→ failed")),
    "场景 2 应经过 failed 状态",
  );
  console.assert(
    m2.log.some((l) => l.includes("rolled-back")),
    "场景 2 应完成回滚",
  );

  // 场景 3：灰度 10% 未命中 → 直接回 idle
  const m3 = new UpdateMachine();
  const rollout10 = makeManifest(goodPayload, 10);
  // 先找一个确定不命中的设备号，避免演示结果不稳定
  let missDevice = "device-x";
  for (let i = 0; i < 10_000; i++) {
    if (!UpdateMachine.inRollout(`device-${i}`, 10)) {
      missDevice = `device-${i}`;
      break;
    }
  }
  const s3 = m3.run({
    deviceId: missDevice,
    currentVersion: "2.3.0",
    manifest: rollout10,
    downloadedPayload: goodPayload,
    publicKey,
  });
  console.log(`场景 3（灰度 10%，设备 ${missDevice}）：${m3.log.join("；")}`);
  console.assert(s3 === "idle" && m3.log.length === 2, "场景 3 应在检查后回 idle");

  // 场景 4：非法迁移被状态机拒绝
  const m4 = new UpdateMachine();
  let rejected = false;
  try {
    // @ts-expect-error 故意从 idle 直接跳 applying
    m4["transit"]("applying", "测试注入");
  } catch (e) {
    rejected = e instanceof UpdateError;
  }
  console.assert(rejected, "非法迁移 idle→applying 必须被拒绝");
  console.log("场景 4：非法迁移 idle → applying 被状态机拒绝 ✅");

  console.log("\n✅ 自动更新状态机四个场景全部通过");
}

runUpdateDemo();
