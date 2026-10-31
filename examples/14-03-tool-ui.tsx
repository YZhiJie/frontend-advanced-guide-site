// 文件: examples/14-03-tool-ui.tsx —— 工具调用的 UI 映射:注册表模式
import { useState } from 'react';

// ① 工具注册表:每个工具声明"呈现组件 + 是否需要用户确认"
interface ToolDef {
    label: string;
    confirm?: boolean;                    // 敏感操作(发邮件/下单)先弹确认
    render: (args: Record<string, unknown>, result?: unknown) => React.ReactNode;
}

const toolRegistry: Record<string, ToolDef> = {
    queryWeather: {
        label: '查询天气',
        render: (args, result) => (
            <span>🌤️ {String(args.city)}:{result ? ` ${JSON.stringify(result)}` : ' 查询中...'}</span>
        ),
    },
    sendEmail: {
        label: '发送邮件',
        confirm: true,                    // 有副作用的操作必须人工确认
        render: (args, result) => (
            <span>📧 给 {String(args.to)} 发邮件 {result ? '✅ 已发送' : '(等待确认)'}</span>
        ),
    },
};

// ② 会话渲染:按事件顺序呈现思考/工具/文本三种片段
interface Segment { type: 'text' | 'tool'; name?: string; args?: Record<string, unknown>; result?: unknown; text?: string }

export function ChatMessage({ segments }: { segments: Segment[] }) {
    const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
    return (
        <div>
            {segments.map((seg, i) => {
                if (seg.type === 'text') return <p key={i}>{seg.text}</p>;
                const def = toolRegistry[seg.name!];
                const isWaitingConfirm = def.confirm && !confirmed[`${i}`];
                return (
                    <div key={i} className="tool-chip">
                        {def.render(seg.args!, isWaitingConfirm ? undefined : seg.result)}
                        {isWaitingConfirm && (
                            <button onClick={() => setConfirmed((c) => ({ ...c, [`${i}`]: true }))}>
                                允许执行
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
