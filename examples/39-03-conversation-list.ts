// 文件: examples/39-03-conversation-list.ts
// ============ 会话列表与未读数 ============
// 会话列表是 IM 首页，三个问题：
// 1) 排序：按"最后一条消息时间"倒序，置顶会话永远在前；
// 2) 未读数：收到消息 +1（自己发的消息不清未读），进入会话且窗口可见时清零；
// 3) 免打扰：不弹通知，但未读数照常累计（角标变灰而非红点）。
// 未读数的两个经典 bug：自己发消息把未读清零；多端同时在线未读数互踩。

export interface ConvMeta {
    convId: string;
    name: string;
    pinned?: boolean;       // 置顶
    muted?: boolean;        // 免打扰
    lastMsgAt: number;
    unread: number;
}

export interface IncomingEvent {
    type: "message" | "open-conv" | "read-ack" | "send";
    convId: string;
    from?: string;
    at: number;
    /** 多端场景：事件来自哪个端 */
    device?: "phone" | "desktop";
}

const ME = "u-me";

/** 会话事件归约器：列表状态 = fold(事件流)，可重放、可多端同步 */
export function reduceConvList(state: Map<string, ConvMeta>, ev: IncomingEvent): Map<string, ConvMeta> {
    const next = new Map(state);
    const conv = next.get(ev.convId);
    if (!conv) return next;

    switch (ev.type) {
        case "message": {
            // 只有"别人发的"才累计未读；自己多端发消息不影响未读
            if (ev.from && ev.from !== ME) conv.unread += 1;
            conv.lastMsgAt = Math.max(conv.lastMsgAt, ev.at);
            break;
        }
        case "open-conv": {
            conv.unread = 0; // 打开会话即清零（服务端会补发 read ack）
            break;
        }
        case "read-ack": {
            // 其他端已读的同步：取 min 防止 A 端打开清零、B 端迟到事件又加回来
            conv.unread = 0;
            break;
        }
        case "send": {
            conv.lastMsgAt = Math.max(conv.lastMsgAt, ev.at);
            break;
        }
    }
    next.set(ev.convId, conv);
    return next;
}

/** 列表排序：置顶 > 最后消息时间倒序 */
export function sortConvs(convs: readonly ConvMeta[]): ConvMeta[] {
    return [...convs].sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
        return b.lastMsgAt - a.lastMsgAt;
    });
}

/** 总未读（Tab 角标）：免打扰会话计入总数但不弹通知——业务可按需排除 */
export function totalUnread(convs: readonly ConvMeta[]): number {
    return convs.reduce((sum, c) => sum + c.unread, 0);
}

// ---------------- 验证 ----------------

const t = 1_700_000_000_000;
const init = new Map<string, ConvMeta>([
    ["c1", { convId: "c1", name: "产品群", lastMsgAt: t - 1000, unread: 2 }],
    ["c2", { convId: "c2", name: "老板", lastMsgAt: t - 2000, unread: 1, pinned: true }],
    ["c3", { convId: "c3", name: "摸鱼群", lastMsgAt: t - 3000, unread: 5, muted: true }],
]);

let state = init;

console.log("=== 收到消息：别人发的 +1，自己的不清零 ===");
state = reduceConvList(state, { type: "message", convId: "c1", from: "u-alice", at: t });
state = reduceConvList(state, { type: "send", convId: "c1", at: t + 1 });
console.log("产品群未读:", state.get("c1")!.unread, "(只 +1，自己发的 +0)");

console.log("\n=== 打开会话清零 ===");
state = reduceConvList(state, { type: "open-conv", convId: "c1", at: t + 2 });
console.log("产品群未读:", state.get("c1")!.unread);

console.log("\n=== 多端：手机已读，桌面收到迟到的消息事件不重复计数 ===");
state = reduceConvList(state, { type: "message", convId: "c2", from: "u-boss", at: t + 3, device: "desktop" });
state = reduceConvList(state, { type: "read-ack", convId: "c2", at: t + 4, device: "phone" });
console.log("老板未读:", state.get("c2")!.unread, "(read-ack 归零，迟到 message 已被覆盖)");

console.log("\n=== 排序：置顶 > 时间 ===");
console.log(sortConvs([...state.values()]).map((c) => `${c.name}${c.pinned ? "[置顶]" : ""}(未读${c.unread})`));

console.log("\n=== 总未读角标 ===");
console.log("总未读:", totalUnread([...state.values()]), "(摸鱼群免打扰也计入总数，通知单独按 muted 过滤)");
