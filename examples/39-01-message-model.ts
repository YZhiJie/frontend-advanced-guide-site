// 文件: examples/39-01-message-model.ts
// ============ 消息模型：状态机与 ID 设计 ============
// 一条 IM 消息的一生是一个状态机：
//   sending → sent(服务端已确认) → delivered(对方端已收到) → read(对方已读)
//           ↘ failed(超时未确认，可重发)
// 两个 ID 的分工是本节核心：
// - clientId（临时 ID）：发送前由客户端生成（uuid），用于界面占位 + 重发去重；
// - serverId：服务端确认时下发，是全系统排序与幂等的最终依据。

export type MsgStatus = "sending" | "sent" | "delivered" | "read" | "failed";

export interface Message {
    clientId: string;      // 客户端临时 ID（发送前生成）
    serverId?: string;     // 服务端 ID（确认后回填）
    convId: string;
    from: string;
    content: string;
    status: MsgStatus;
    createdAt: number;
    /** 服务端确认后回填的序列号：会话内单调递增，是排序唯一依据 */
    seq?: number;
}

const STATUS_RANK: Record<MsgStatus, number> = { sending: 0, sent: 1, delivered: 2, read: 3, failed: -1 };

/** 状态推进只允许前进（failed 除外，可回 sending 重发） */
export function transition(msg: Message, next: MsgStatus): Message | null {
    if (msg.status === next) return msg;
    if (msg.status === "failed") {
        if (next === "sending") return { ...msg, status: "sending" }; // 重发
        return null;
    }
    if (STATUS_RANK[next] > STATUS_RANK[msg.status]) return { ...msg, status: next };
    return null; // 非法回退：read → delivered 之类直接拒绝
}

/** 服务端确认：回填 serverId + seq，status 推进到 sent */
export function ackFromServer(msg: Message, serverId: string, seq: number): Message {
    const next = transition(msg, "sent");
    if (!next) throw new Error(`cannot ack a ${msg.status} message`);
    return { ...next, serverId, seq };
}

/** 渲染排序：未确认消息排尾部，已确认按 seq */
export function sortForRender(msgs: readonly Message[]): Message[] {
    return [...msgs].sort((a, b) => {
        if (a.seq !== undefined && b.seq !== undefined) return a.seq - b.seq;
        if (a.seq !== undefined) return -1;   // 已确认在前
        if (b.seq !== undefined) return 1;
        return a.createdAt - b.createdAt;     // 未确认按创建时间
    });
}

// ---------------- 验证 ----------------

let cidSeq = 0;
function newMsg(content: string): Message {
    return {
        clientId: `c-${++cidSeq}`,
        convId: "conv-1",
        from: "me",
        content,
        status: "sending",
        createdAt: 1700000000000 + cidSeq * 100,
    };
}

console.log("=== 状态机推进 ===");
let m = newMsg("你好");
console.log("初始:", m.status, "(界面显示转圈)");

m = ackFromServer(m, "srv-1001", 42);
console.log("服务端 ACK:", m.status, `serverId=${m.serverId} seq=${m.seq}`, "(转圈消失)");

const d = transition(m, "delivered");
const r = transition(d!, "read");
console.log("对方收到:", d!.status, "→ 对方已读:", r!.status);

const illegal = transition(r!, "delivered");
console.log("已读回退到已送达:", illegal, "(null = 拒绝非法回退)");

console.log("\n=== 发送失败与重发 ===");
let f = newMsg("这条会失败");
f = { ...f, status: "failed" }; // 超时未 ACK
console.log("失败:", f.status, "(界面显示红色感叹号)");
f = transition(f, "sending")!;
console.log("点重发 →", f.status, "→ 重新走 ACK（clientId 不变，服务端可幂等去重）");

console.log("\n=== 渲染排序：未确认消息永远在已确认之后 ===");
const m1 = ackFromServer(newMsg("第一条"), "srv-1", 1);
const m3 = ackFromServer(newMsg("第三条"), "srv-3", 3);
const m2 = ackFromServer(newMsg("第二条"), "srv-2", 2);
const pending = newMsg("还没确认");       // seq 为空
const list = sortForRender([m3, pending, m1, m2]);
console.log(list.map((x) => `${x.content}${x.seq ? `#${x.seq}` : "(pending)"}`));
