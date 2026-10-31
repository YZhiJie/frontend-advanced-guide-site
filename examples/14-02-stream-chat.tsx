// 文件: examples/14-02-stream-chat.tsx —— [浏览器] 完整的流式对话组件
import { useCallback, useRef, useState } from 'react';
import { createSseParser } from './14-01-sse-parser';

export function StreamChat() {
    const [answer, setAnswer] = useState('');
    const [generating, setGenerating] = useState(false);
    const controllerRef = useRef<AbortController | null>(null);
    const pendingRef = useRef('');             // 待渲染缓冲区
    const frameRef = useRef(0);
    const flushScheduledRef = useRef(false);   // 本帧是否已安排刷新

    const stop = useCallback(() => controllerRef.current?.abort(), []);

    const send = useCallback(async (prompt: string) => {
        const controller = new AbortController();
        controllerRef.current = controller;
        setGenerating(true);
        setAnswer('');
        pendingRef.current = '';
        flushScheduledRef.current = false;

        // 核心:rAF 批量刷新 —— 同一帧内到达的多个 token 合并成一次 setState
        // 对比:每个 token 一次 setState → 高频重渲染 + Markdown 反复解析
        const scheduleFlush = () => {
            if (flushScheduledRef.current) return; // 本帧已有刷新排队,合并进去
            flushScheduledRef.current = true;
            frameRef.current = requestAnimationFrame(() => {
                flushScheduledRef.current = false;
                setAnswer((prev) => prev + pendingRef.current); // 累加消费缓冲区
                pendingRef.current = '';
            });
        };

        try {
            const res = await fetch('/api/chat', {   // BFF 代理,Key 不出服务端
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt }),
                signal: controller.signal,           // 用户点"停止"立即断流
            });

            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            // BFF 把各家模型流统一转发为 {text} 简化事件(生产按实际协议调整)
            const parser = createSseParser((e) => {
                if (e.data === '[DONE]') return;
                pendingRef.current += JSON.parse(e.data).text;
                scheduleFlush();
            });

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                parser(decoder.decode(value, { stream: true }));
            }
            setAnswer((prev) => prev + pendingRef.current); // 兜底:刷出缓冲剩余
            pendingRef.current = '';
        } catch (e) {
            if ((e as Error).name !== 'AbortError') console.error(e); // 主动停止不算错误
        } finally {
            cancelAnimationFrame(frameRef.current);
            setGenerating(false);
        }
    }, []);

    return (
        <div>
            <button onClick={() => send('用一句话介绍事件循环')}>提问</button>
            {generating && <button onClick={stop}>■ 停止生成</button>}
            {/* 生产中用增量安全的 Markdown 渲染器,并做 XSS 消毒(见 7.1) */}
            <div className="answer">{answer}</div>
        </div>
    );
}
