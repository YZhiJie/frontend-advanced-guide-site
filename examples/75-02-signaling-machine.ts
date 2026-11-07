// 文件: examples/75-02-signaling-machine.ts
// ============ WebRTC 信令状态机模拟：乱序/重复治理 + 弱网降级阶梯 ============
// 不开摄像头、不建真实 PeerConnection——只模拟「信令通道」这层最考验前端的部分：
//   1) join → offer → answer → ice → connected 全链路状态机
//   2) 乱序治理：ICE 候选比 answer 先到（远端描述还没设置）→ 进待决队列，描述就绪后补放
//   3) 重复治理：消息按 msgId 幂等去重；seq 缺口触发告警
//   4) 冲突治理（glare）：双发同时 offer，polite 端回滚，impolite 端坚持（perfect negotiation）
//   5) 弱网降级阶梯：丢包/RTT 驱动降档，快降慢升 + 滞回窗口
// 全部事件脚本化推进，无定时器无随机，输出确定。

// ---------- 1. 信令消息与状态机 ----------

type SignalType = "join" | "offer" | "answer" | "ice" | "bye";

interface Signal {
  msgId: string; // 全局唯一，幂等去重的键
  seq: number; // 发送方单调递增，检测缺口
  from: string;
  type: SignalType;
  sdp?: string; // offer/answer 的描述
  candidate?: string; // ice 的候选
}

type PeerState =
  | "idle" // 初始
  | "joining" // 正在进房
  | "joined" // 进房成功，尚未协商
  | "negotiating" // 已发出或收到 offer
  | "connecting" // 描述齐备，ICE 打洞中
  | "connected" // 媒体通道建立
  | "closed"; // 离会

const ALLOWED: Record<PeerState, PeerState[]> = {
  idle: ["joining"],
  joining: ["joined", "closed"],
  joined: ["negotiating", "closed"],
  negotiating: ["connecting", "negotiating", "closed"], // 回滚后仍在协商
  connecting: ["connected", "negotiating", "closed"], // ICE 失败可重新协商
  connected: ["negotiating", "closed"], // 弱网重协商
  closed: [],
};

class Peer {
  state: PeerState = "idle";
  polite: boolean; // 冲突时谁让路：polite 回滚自己的 offer
  name: string;
  private seenMsgIds = new Set<string>();
  private lastSeq = 0;
  private pendingIce: string[] = []; // 远端描述就绪前到达的候选
  private remoteDescSet = false;
  private localOfferPending = false; // 自己有未被 answer 的 offer
  appliedIce: string[] = []; // 实际按序应用到「连接」的候选
  sentOffers = 0;
  rollbacks = 0;
  log: string[] = [];

  constructor(name: string, polite: boolean) {
    this.name = name;
    this.polite = polite;
  }

  private transit(next: PeerState) {
    if (!ALLOWED[this.state].includes(next)) {
      throw new Error(`${this.name}: 非法状态迁移 ${this.state} → ${next}`);
    }
    this.log.push(`${this.state} → ${next}`);
    this.state = next;
  }

  join() {
    this.transit("joining");
    this.transit("joined");
  }

  makeOffer(): Signal {
    if (this.state === "joined") this.transit("negotiating");
    this.localOfferPending = true;
    this.sentOffers++;
    return { msgId: `${this.name}-offer-${this.sentOffers}`, seq: 0, from: this.name, type: "offer", sdp: `sdp-of-${this.name}-v${this.sentOffers}` };
  }

  /** 收包入口：先做幂等与排序检查，再按类型分发 */
  receive(sig: Signal, send: (s: Signal) => void) {
    // ① 重复消息：同一 msgId 直接丢弃（网络重传 / 服务端补投很常见）
    if (this.seenMsgIds.has(sig.msgId)) {
      this.log.push(`丢弃重复消息 ${sig.msgId}`);
      return;
    }
    this.seenMsgIds.add(sig.msgId);

    // ② seq 检查：比已见的小是乱序旧消息；跳过编号是缺口（丢消息，生产应触发重同步）
    if (sig.seq > 0 && this.lastSeq > 0) {
      if (sig.seq <= this.lastSeq) {
        this.log.push(`乱序旧消息 seq=${sig.seq}（已见 ${this.lastSeq}），按序容忍`);
      } else if (sig.seq !== this.lastSeq + 1) {
        this.log.push(`检测到 seq 缺口 ${this.lastSeq} → ${sig.seq}，触发重同步告警`);
      }
    }
    if (sig.seq > this.lastSeq) this.lastSeq = sig.seq;

    // ③ 按类型分发
    if (sig.type === "offer") this.onOffer(sig, send);
    else if (sig.type === "answer") this.onAnswer(sig);
    else if (sig.type === "ice") this.onIce(sig);
  }

  private onOffer(sig: Signal, send: (s: Signal) => void) {
    // 冲突（glare）：我也有未完成的 offer —— polite 回滚，impolite 无视对方
    if (this.localOfferPending) {
      if (this.polite) {
        this.rollbacks++;
        this.localOfferPending = false;
        this.log.push(`glare：我是 polite 端，回滚本地 offer，接受 ${sig.sdp}`);
      } else {
        this.log.push(`glare：我是 impolite 端，无视 ${sig.sdp}`);
        return;
      }
    }
    this.remoteDescSet = true;
    if (this.state === "joined") this.transit("negotiating");
    this.flushIce();
    // 回 answer
    send({ msgId: `${this.name}-answer-1`, seq: 0, from: this.name, type: "answer", sdp: `sdp-answer-of-${this.name}` });
  }

  private onAnswer(sig: Signal) {
    if (!this.localOfferPending) {
      this.log.push(`收到无主的 answer ${sig.msgId}，忽略`);
      return;
    }
    this.localOfferPending = false;
    this.remoteDescSet = true;
    this.transit("connecting");
    this.flushIce();
  }

  private onIce(sig: Signal) {
    // ③ 乱序治理：远端描述还没设置，候选先进待决队列
    if (!this.remoteDescSet) {
      this.pendingIce.push(sig.candidate!);
      this.log.push(`候选 ${sig.candidate} 先于描述到达，入待决队列（队深 ${this.pendingIce.length}）`);
      return;
    }
    this.appliedIce.push(sig.candidate!);
  }

  /** 描述就绪后补放待决候选，保持到达顺序 */
  private flushIce() {
    while (this.pendingIce.length) {
      this.appliedIce.push(this.pendingIce.shift()!);
      this.log.push(`补放待决候选，当前已应用 ${this.appliedIce.length} 个`);
    }
  }

  /** 模拟 ICE 打洞完成 */
  markConnected() {
    if (this.state === "connecting") this.transit("connected");
  }
}

// ---------- 2. 场景脚本：双发 glare + 乱序 ICE + 重复消息 ----------

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`断言失败: ${msg}`);
}

console.log("========== 1. 进房与双发 offer（glare 冲突） ==========");
const alice = new Peer("alice", false); // impolite：坚持己见
const bob = new Peer("bob", true); // polite：主动让路
alice.join();
bob.join();
console.log(`alice=${alice.state}，bob=${bob.state}`);
assert(alice.state === "joined" && bob.state === "joined", "双发应进房成功");

// 双方几乎同时发 offer（real world：双方都把对方当「后来者」）
const offerA = alice.makeOffer();
const offerB = bob.makeOffer();

// 投递：alice 收到 bob 的 offer（impolite 无视）；bob 收到 alice 的 offer（polite 回滚并接受）
let bobAnswer: Signal | null = null;
alice.receive(offerB, () => {});
bob.receive(offerA, (s) => (bobAnswer = s));
console.log(`alice: ${alice.log[alice.log.length - 1]}`);
console.log(`bob: ${bob.log[bob.log.length - 2]} / 回滚次数=${bob.rollbacks}`);
assert(alice.sentOffers === 1 && bob.rollbacks === 1, "polite 端应回滚一次");
assert(bobAnswer !== null, "bob 应回 answer");

console.log("\n========== 2. answer 送达与重复去重 ==========");
const answerDup: Signal = { ...(bobAnswer as Signal) }; // 服务端补投的重复 answer
alice.receive(bobAnswer as Signal, () => {}); // alice 收到 answer → connecting
alice.receive(answerDup, () => {}); // 重复 answer 应被 msgId 去重
console.log(`alice 状态=${alice.state}；${alice.log[alice.log.length - 1]}`);
assert(alice.state === "connecting", "alice 收到 answer 后应进入 connecting");
assert(alice.log.some((l) => l.includes("丢弃重复消息")), "重复 answer 应被去重");

// 描述就绪后到达的候选直接应用
alice.receive({ msgId: "bob-ice-1", seq: 1, from: "bob", type: "ice", candidate: "candidate-b1" }, () => {});
assert(alice.appliedIce.join() === "candidate-b1", "alice 应直接应用候选");

console.log("\n========== 3. 乱序 ICE：候选比 offer 先到（待决队列） ==========");
// 新的一对：carol 发 offer，但 dave 先收到 carol 的 3 个 ICE 候选（UDP 候选生成快、信令通道乱序）
const carol = new Peer("carol", false);
const dave = new Peer("dave", true);
carol.join();
dave.join();
const offerC = carol.makeOffer();

dave.receive({ msgId: "c-ice-1", seq: 1, from: "carol", type: "ice", candidate: "c1" }, () => {});
dave.receive({ msgId: "c-ice-2", seq: 2, from: "carol", type: "ice", candidate: "c2" }, () => {});
dave.receive({ msgId: "c-ice-2", seq: 2, from: "carol", type: "ice", candidate: "c2" }, () => {}); // 重复投递
dave.receive({ msgId: "c-ice-3", seq: 5, from: "carol", type: "ice", candidate: "c3" }, () => {}); // seq 跳号 → 缺口告警
console.log(`dave: ${dave.log[dave.log.length - 3]}`);
console.log(`dave: ${dave.log[dave.log.length - 1]}`);
assert(dave.appliedIce.length === 0, "dave 描述未就绪，候选应全部排队");
assert(dave.log.some((l) => l.includes("seq 缺口")), "seq 跳号应触发缺口告警");

dave.receive(offerC, () => {}); // offer 到达 → 描述就绪 → 按到达顺序补放
console.log(`dave 补放后候选顺序: ${dave.appliedIce.join(" → ")}`);
assert(dave.appliedIce.join() === "c1,c2,c3", "补放必须保持原始到达顺序且不含重复");

alice.markConnected();
dave.markConnected();
console.log(`alice=${alice.state}，dave=${dave.state}`);
assert(alice.state === "connected", "alice 应建连");

// ---------- 3. 弱网降级阶梯 ----------

console.log("\n========== 4. 弱网降级阶梯（快降慢升 + 滞回） ==========");

interface Rung {
  label: string;
  height: number; // 纵向分辨率
  fps: number;
  audioOnly: boolean;
}
/** 降级阶梯：从高到低逐档退让，「只收音频」是最后底线 */
const LADDER: Rung[] = [
  { label: "1080p30", height: 1080, fps: 30, audioOnly: false },
  { label: "720p30", height: 720, fps: 30, audioOnly: false },
  { label: "720p15", height: 720, fps: 15, audioOnly: false },
  { label: "360p15", height: 360, fps: 15, audioOnly: false },
  { label: "只收音频", height: 0, fps: 0, audioOnly: true },
];

interface Metrics {
  rttMs: number;
  lossPct: number; // 丢包率 %
}

/** 健康判定：任一指标越界即不健康 */
const healthy = (m: Metrics) => m.rttMs <= 300 && m.lossPct <= 5;

class LadderController {
  level = 0; // 从最高档起步
  private goodStreak = 0; // 连续健康窗口数
  private readonly UPGRADE_AFTER = 3; // 连续 3 个健康窗口才升档（滞回）

  feed(m: Metrics): string {
    if (!healthy(m)) {
      this.goodStreak = 0;
      if (this.level < LADDER.length - 1) {
        this.level++; // 不健康立即降一档（快降）
        return `指标恶化(rtt=${m.rttMs}, loss=${m.lossPct}%) → 降到 ${LADDER[this.level].label}`;
      }
      return `已在最低档 ${LADDER[this.level].label}，保持音频兜底`;
    }
    this.goodStreak++;
    if (this.level > 0 && this.goodStreak >= this.UPGRADE_AFTER) {
      this.level--; // 慢升：一次只升一档
      this.goodStreak = 0;
      return `连续 ${this.UPGRADE_AFTER} 个健康窗口 → 回升到 ${LADDER[this.level].label}`;
    }
    return `健康(${this.goodStreak}/${this.UPGRADE_AFTER})，维持 ${LADDER[this.level].label}`;
  }
}

const ctl = new LadderController();
// 脚本化网络质量时间线：开局良好 → 突发弱网 → 逐渐恢复 → 抖动一次 → 彻底恢复
const timeline: Metrics[] = [
  { rttMs: 80, lossPct: 1 },
  { rttMs: 90, lossPct: 2 },
  { rttMs: 450, lossPct: 12 }, // 突发弱网
  { rttMs: 500, lossPct: 18 }, // 持续恶化
  { rttMs: 600, lossPct: 25 }, // 再恶化
  { rttMs: 200, lossPct: 4 }, // 开始恢复
  { rttMs: 150, lossPct: 3 },
  { rttMs: 120, lossPct: 2 }, // 第 3 个健康窗口 → 应升一档
  { rttMs: 380, lossPct: 9 }, // 抖动 → 立即降回
  { rttMs: 100, lossPct: 1 },
  { rttMs: 90, lossPct: 1 },
  { rttMs: 85, lossPct: 1 }, // 再次连续 3 健康 → 升档
];
timeline.forEach((m, i) => console.log(`窗口${String(i + 1).padStart(2)}: ${ctl.feed(m)}`));

// 教学要点：窗口 9 的一次抖动把回升成果清零，最终只能回到 720p15——这正是「快降慢升」的代价与意义
assert(ctl.level === 2, `最终应回升到 720p15（level 2），实际 level=${ctl.level}`);
assert(LADDER[ctl.level].label === "720p15", "最终档位应为 720p15");

// 极端弱网直通音频兜底
const ctl2 = new LadderController();
for (let i = 0; i < 6; i++) ctl2.feed({ rttMs: 900, lossPct: 40 });
assert(LADDER[ctl2.level].audioOnly, "持续极端弱网应退到只收音频");
console.log(`极端弱网 6 窗口后: ${LADDER[ctl2.level].label}（音频兜底达成）`);

console.log("\n✅ 全部断言通过：状态机、乱序/重复/冲突治理、降级阶梯均按预期工作");
