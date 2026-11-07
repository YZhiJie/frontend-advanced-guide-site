// 文件: examples/24-01-ai-collab-contract.ts
// AI 协作工程化四阶段的最小可运行闭环：
//   ① 契约定义（类型签名 + 用例表 + 不变量）→ ② AI 生成（v1，含典型错误）
//   → ③ 迭代修复（把门禁失败原文喂回，产出 v2）→ ④ 质量验收（契约符合性门禁）。
// 场景：解析 LLM API 的 SSE 数据行，提取增量文本——纯函数、边界密集，最适合演示。
// 运行方式：npx tsx examples/24-01-ai-collab-contract.ts

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

interface ParsedEvent {
    text: string;
    done: boolean;
}

// ============ ① 契约定义（人写，是 AI 的唯一事实来源） ============

interface Contract {
    name: string;
    signature: string;
    // 用例表：输入 → 期望输出（边界用例必须包含非法 JSON / 空输入 / 哨兵行）
    cases: Array<{ input: string; expect: Result<ParsedEvent>; desc: string }>;
    // 不变量：对所有输入都成立的性质（面状验证，补用例表覆盖不到的洞）
    invariants: Array<{ name: string; check: (input: string, out: Result<ParsedEvent>) => boolean }>;
}

const contract: Contract = {
    name: 'parseSseLine：解析 LLM API 的 SSE 数据行',
    signature: '(line: string) => Result<{ text: string; done: boolean }>',
    cases: [
        { input: 'data: {"delta": "你好"}', expect: { ok: true, value: { text: '你好', done: false } }, desc: '普通增量行' },
        { input: 'data: {"delta": ""}', expect: { ok: true, value: { text: '', done: false } }, desc: '空增量（心跳后的空包）' },
        { input: 'data: [DONE]', expect: { ok: true, value: { text: '', done: true } }, desc: '流结束哨兵行' },
        { input: ': keep-alive', expect: { ok: true, value: { text: '', done: false } }, desc: 'SSE 注释行，静默忽略' },
        { input: 'data: {broken json', expect: { ok: false, error: 'invalid json' }, desc: '非法 JSON → 错误路径而非抛异常' },
        { input: '', expect: { ok: true, value: { text: '', done: false } }, desc: '空行（事件分隔符）静默忽略' },
    ],
    invariants: [
        { name: '任何输入不得抛异常，必须返回 Result', check: () => true }, // 由 runner 的 try/catch 强制
        { name: 'done=true 时 text 必须为空', check: (_i, out) => !out.ok || !out.value.done || out.value.text === '' },
        { name: '纯函数：同一输入两次调用结果一致', check: () => true }, // 由 runner 双跑比对强制
    ],
};

// ============ ② AI 生成（v1 初版——故意保留 AI 最典型的两类错误） ============

function parseSseLine_v1(line: string): Result<ParsedEvent> {
    // 错误一：没有 try/catch——非法 JSON 直接抛异常，违反不变量 1
    const payload = JSON.parse(line.replace(/^data:\s*/, ''));
    // 错误二：没识别 [DONE] 哨兵——把文本当增量返回
    if (typeof payload === 'string') return { ok: true, value: { text: payload, done: false } };
    return { ok: true, value: { text: payload.delta ?? '', done: false } };
}

// ============ ③ 迭代修复（v2——把门禁失败报告喂回 AI 后的产出） ============

function parseSseLine_v2(line: string): Result<ParsedEvent> {
    // 修复：注释行/空行/非 data 行静默忽略；[DONE] 哨兵返回 done；JSON 解析进 try/catch
    if (line === '' || line.startsWith(':')) return { ok: true, value: { text: '', done: false } };
    if (!line.startsWith('data:')) return { ok: false, error: 'unknown line prefix' };
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') return { ok: true, value: { text: '', done: true } };
    try {
        const parsed = JSON.parse(payload) as { delta?: string };
        return { ok: true, value: { text: parsed.delta ?? '', done: false } };
    } catch {
        return { ok: false, error: 'invalid json' };
    }
}

// ============ ④ 质量验收：契约符合性门禁（机器验收，不是人验收） ============

interface GateReport {
    pass: number;
    failures: string[];
}

function runContractGate(impl: (line: string) => Result<ParsedEvent>, contract: Contract): GateReport {
    const failures: string[] = [];
    let pass = 0;

    for (const c of contract.cases) {
        let out: Result<ParsedEvent>;
        try {
            out = impl(c.input);
        } catch (e) {
            failures.push(`[用例] ${c.desc}：实现抛出异常 ${(e as Error).message}（违反不变量 1）`);
            continue;
        }
        if (JSON.stringify(out) === JSON.stringify(c.expect)) {
            pass++;
        } else {
            failures.push(`[用例] ${c.desc}：期望 ${JSON.stringify(c.expect)}，实际 ${JSON.stringify(out)}`);
        }
    }

    for (const inv of contract.invariants) {
        if (inv.check === undefined) continue;
        // 纯函数性双跑比对 + 不变量逐用例抽验（demo 简化：抽验全部用例）
        for (const c of contract.cases) {
            try {
                const a = impl(c.input);
                const b = impl(c.input);
                if (JSON.stringify(a) !== JSON.stringify(b)) {
                    failures.push(`[不变量] ${inv.name}：输入 ${JSON.stringify(c.input)} 两次调用结果不一致`);
                    break;
                }
                if (!inv.check(c.input, a)) {
                    failures.push(`[不变量] ${inv.name}：在用例「${c.desc}」上被违反`);
                    break;
                }
            } catch {
                break; // 异常已计入用例失败，避免重复报告
            }
        }
    }
    return { pass, failures };
}

// ============ 演示：v1 不过门禁 → 修复报告即提示词 → v2 全绿 ============

function main(): void {
    console.log(`契约：${contract.name}`);
    console.log(`签名：${contract.signature}`);
    console.log(`用例 ${contract.cases.length} 条，不变量 ${contract.invariants.length} 条\n`);

    for (const [label, impl] of [['v1（AI 初版）', parseSseLine_v1], ['v2（修复后）', parseSseLine_v2]] as const) {
        const report = runContractGate(impl, contract);
        console.log(`── ${label} 门禁报告 ──`);
        if (report.failures.length === 0) {
            console.log(`✓ 全部通过（用例 ${report.pass}/${contract.cases.length} + 不变量无违反）`);
        } else {
            console.log(`✗ 通过 ${report.pass}/${contract.cases.length}，失败 ${report.failures.length} 项：`);
            for (const f of report.failures) console.log(`   ${f}`);
            console.log('   ↑ 这段报告原文就是"迭代修复"阶段喂回给 AI 的提示词\n');
        }
    }
}

main();
