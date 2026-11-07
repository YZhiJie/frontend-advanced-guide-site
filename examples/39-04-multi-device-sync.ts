// 文件: examples/39-04-multi-device-sync.ts
// ============ 多端同步与离线消息：seq 游标 ============
// 手机 + 电脑同时在线，消息必须在两端保持一致。方案：每会话维护服务端 seq（单调递增），
// 每个端记录"已同步到的 seq"（游标），上线/重连后带着游标拉增量：
//   sync(convId, cursor) → 服务端返回 seq > cursor 的消息 → 客户端按 seq 排序入列。
// 推送（WebSocket 实时下发）与拉取（sync 增量）互补：
// 推送解决"在线时的实时性"，拉取解决"离线/掉线期间的完整性"。
// 推送丢了一条没关系——下一条消息的 seq 出现空洞，触发补拉。

export interface Msg {
    seq: number;      // 会话内单调递增
    from: string;
    content: string;
}

export class ConvServer {
    private seqCounter = 0;
    private log: Msg[] = [];
    /** 推送通道投递记录：模拟 WebSocket 推送可能丢 */
    readonly pushedTo = new Map<string, Msg[]>();

    append(from: string, content: string): Msg {
        const msg: Msg = { seq: ++this.seqCounter, from, content };
        this.log.push(msg);
        return msg;
    }

    /** 模拟推送：target 设备在线才收得到（在线 = pushedTo 里注册过） */
    pushTo(device: string, msg: Msg): void {
        if (!this.pushedTo.has(device)) return; // 离线设备收不到推送
        this.pushedTo.get(device)!.push(msg);
    }

    /** 增量同步接口：返回 seq > cursor 的全部消息 */
    sync(cursor: number): Msg[] {
        return this.log.filter((m) => m.seq > cursor);
    }
}

export class Device {
    /** 已同步到的最大 seq（游标，持久化在本地） */
    cursor = 0;
    readonly timeline: Msg[] = [];
    readonly seenSeq = new Set<number>();

    constructor(readonly name: string) {}

    /** 处理推送：只接受 seq 恰好连续的消息？不——全部接受，靠空洞检测触发补拉 */
    onPush(msg: Msg): "accepted" | "dup" | "hole" {
        if (this.seenSeq.has(msg.seq)) return "dup";       // 重复推送丢弃
        this.seenSeq.add(msg.seq);
        this.timeline.push(msg);
        this.cursor = Math.max(this.cursor, msg.seq);
        // seq 有空洞（如 cursor=2 却直接收到 5）→ 记录 hole，由外层触发 sync 补拉
        return this.timeline.some((m) => m.seq === msg.seq - 1) || msg.seq === this.timeline[0]!.seq ? "accepted" : "hole";
    }

    /** 重连后补拉：拉到本地最大 seq 之后的全部消息 */
    syncFrom(server: ConvServer): Msg[] {
        const missed = server.sync(this.cursor);
        for (const m of missed) {
            if (!this.seenSeq.has(m.seq)) {
                this.seenSeq.add(m.seq);
                this.timeline.push(m);
                this.cursor = Math.max(this.cursor, m.seq);
            }
        }
        this.timeline.sort((a, b) => a.seq - b.seq);
        return missed;
    }

    /** 时间线连续性自检 */
    isContiguous(): boolean {
        return this.timeline.every((m, i) => i === 0 || m.seq === this.timeline[i - 1]!.seq + 1);
    }
}

// ---------------- 验证 ----------------

const server = new ConvServer();
const phone = new Device("手机");
const desktop = new Device("电脑");

console.log("=== 在线期间：推送实时到达 ===");
server.pushedTo.set("手机", []); // 两端在线
server.pushedTo.set("电脑", []);
for (const content of ["早上好", "会议改到三点", "收到"]) {
    const m = server.append("u-alice", content);
    server.pushTo("手机", m);
    server.pushTo("电脑", m);
}
console.log("手机时间线:", phone.timeline.map((m) => m.seq), "连续:", phone.isContiguous());
console.log("电脑时间线:", desktop.timeline.map((m) => m.seq), "连续:", desktop.isContiguous());

console.log("\n=== 电脑离线 3 条 → 回来后带游标补拉 ===");
for (const content of ["补发1", "补发2", "补发3"]) {
    const m = server.append("u-bob", content);
    server.pushTo("手机", m); // 电脑离线收不到推送
}
console.log("推送丢失后电脑 cursor:", desktop.cursor, "时间线:", desktop.timeline.length, "条");
const missed = desktop.syncFrom(server);
console.log("补拉到:", missed.map((m) => m.seq), "补后时间线:", desktop.timeline.map((m) => m.seq), "连续:", desktop.isContiguous());

console.log("\n=== 空洞检测：推送乱序/丢一条 → 下一条触发 hole ===");
const d2 = new Device("新设备");
server.pushedTo.set("新设备", []);
const all = server.sync(0);
// 模拟丢掉 seq=2 的推送，直接收到 3
d2.onPush(all.find((m) => m.seq === 1)!);
const holeResult = d2.onPush(all.find((m) => m.seq === 3)!);
console.log("直接收到 seq=3 的判定:", holeResult, "→ 触发 syncFrom 补拉");
d2.syncFrom(server);
console.log("补拉后连续:", d2.isContiguous(), "时间线:", d2.timeline.map((m) => m.seq));

console.log("\n=== 重复推送去重 ===");
console.log("再次收到 seq=1:", d2.onPush(all[0]!)); // dup
