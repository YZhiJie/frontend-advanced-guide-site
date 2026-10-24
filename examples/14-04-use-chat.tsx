// 文件: examples/14-04-use-chat.tsx —— useChat 形态示意(以 Vercel AI SDK 为原型)
import { useChat } from '@ai-sdk/react';

export function AssistantPanel() {
    const { messages, sendMessage, status, stop, error } = useChat({
        // transport 指向自己的 BFF(服务端持有 Key 并做限流)
        transport: { api: '/api/chat' },
        onError: (e) => console.error('对话失败:', e),
    });

    return (
        <div>
            {messages.map((m) => (
                <div key={m.id}>
                    <b>{m.role === 'user' ? '我' : 'AI'}</b>
                    {/* parts 区分文本段与工具调用段,分别渲染(呼应 14.3) */}
                    {m.parts.map((part, i) =>
                        part.type === 'text' ? <p key={i}>{part.text}</p> : <ToolChip key={i} part={part} />,
                    )}
                </div>
            ))}

            {status === 'streaming'
                ? <button onClick={stop}>■ 停止</button>
                : <button disabled={status !== 'ready'} onClick={() => sendMessage({ text: '总结一下上面的内容' })}>
                    继续追问
                  </button>}
            {error && <p className="error">出错了,已自动保留上下文,可重试</p>}
        </div>
    );
}

function ToolChip({ part }: { part: { type: string } }) {
    return <code className="chip">🛠️ 工具调用片段</code>;
}
