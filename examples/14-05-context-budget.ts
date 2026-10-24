// 文件: examples/14-05-context-budget.ts —— 上下文预算管理:对话历史裁剪
interface ChatMsg { role: 'user' | 'assistant'; content: string }

/** 粗略估算 token 数(中文 ≈ 1 字/token,英文 ≈ 4 字符/token,生产用官方 tokenizer) */
function estimateTokens(text: string): number {
    const cjk = (text.match(/[一-鿿]/g) ?? []).length;
    return cjk + Math.ceil((text.length - cjk) / 4);
}

/**
 * 裁剪策略:始终保留 system 与最近 N 条,超预算时把更早的历史折叠成一条摘要
 * —— 完整历史仍在数据库里,只是不再随每次请求发送
 */
export function buildContext(history: ChatMsg[], budget = 3000): ChatMsg[] {
    const kept: ChatMsg[] = [];
    let used = 0;
    // 从最新往回保留
    for (let i = history.length - 1; i >= 0; i--) {
        const cost = estimateTokens(history[i].content);
        if (used + cost > budget * 0.8 && kept.length >= 2) break; // 至少保留 2 条近期对话
        kept.unshift(history[i]);
        used += cost;
    }
    const dropped = history.length - kept.length;
    if (dropped > 0) {
        kept.unshift({
            role: 'user',
            content: `[系统提示:更早的 ${dropped} 条对话已省略,涉及主题:项目讨论与部署方案]`, // 摘要占位
        });
    }
    console.log(`保留 ${kept.length} 条,约 ${used} tokens,预算 ${budget}`);
    return kept;
}

// ---- 验证 ----
const history: ChatMsg[] = Array.from({ length: 50 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user',
    content: `第 ${i} 条消息,包含一些中文内容与 english words mixed in`,
}));
buildContext(history, 3000);
