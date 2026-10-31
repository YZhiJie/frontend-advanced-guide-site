// @ts-nocheck
// 文件: examples/ai-interview/use-typewriter.ts —— [浏览器/React] 生产级打字机 Hook
// 运行方式: 需 React 18+ 项目（import 后在组件中使用）
// 关联文档: 21-frontend-ai-interview.md 21.2.4
import { useCallback, useEffect, useRef, useState } from 'react';

export interface TypewriterState {
    text: string;
    status: 'idle' | 'playing' | 'paused' | 'done';
}

// 可调参数：积压越多消费越快；最长在 DRAIN_MS 内追平网络流
const MAX_FRAME_CHARS = 6; // 单帧最多吐字，限制视觉跳动
const DRAIN_MS = 240; // 期望追平积压的时间窗口

/**
 * rAF 队列打字机：
 * - 网络块入队（push），rAF 每帧按自适应预算消费 → 同帧多块只提交一次 setState
 * - 支持暂停/继续（只暂停消费，不暂停网络）、停止（立即呈现全部已到达文本）
 * - 切后台 rAF 自动暂停，不会像 setInterval 那样漂移堆积
 */
export function useTypewriter() {
    const [text, setText] = useState('');
    const [status, setStatus] = useState<TypewriterState['status']>('idle');
    const fullRef = useRef(''); // 已到达的完整文本
    const shownRef = useRef(0); // 已展示到第几个字符
    const rafRef = useRef(0);
    const lastTickRef = useRef(0);
    const pausedRef = useRef(false);

    const tick = useCallback((now: number) => {
        rafRef.current = requestAnimationFrame(tick);
        if (pausedRef.current) {
            lastTickRef.current = now;
            return;
        }
        const pending = fullRef.current.length - shownRef.current;
        if (pending === 0) return; // 无积压时空转极廉价；也可取消调度、来时再启动

        const elapsed = now - lastTickRef.current || 16;
        lastTickRef.current = now;
        // 自适应预算：按追平窗口算目标速度，再用单帧上限夹住视觉跳动
        const byDrain = Math.ceil(pending / Math.max(1, DRAIN_MS / elapsed));
        const step = Math.min(pending, Math.max(1, byDrain), MAX_FRAME_CHARS);
        shownRef.current += step;
        setText(fullRef.current.slice(0, shownRef.current));
    }, []);

    // 网络块入队（由 SSE onEvent 调用）
    const push = useCallback((chunk: string) => {
        if (!chunk) return;
        fullRef.current += chunk;
        setStatus((s) => (s === 'done' ? s : 'playing'));
    }, []);

    const pause = useCallback(() => {
        pausedRef.current = true;
        setStatus('paused');
    }, []);

    const resume = useCallback(() => {
        pausedRef.current = false;
        setStatus('playing');
    }, []);

    // 停止：立即呈现已到达的全部文本并取消调度（用户的掌控感优先于打字形式）
    const stop = useCallback(() => {
        cancelAnimationFrame(rafRef.current);
        shownRef.current = fullRef.current.length;
        setText(fullRef.current);
        setStatus('done');
    }, []);

    const reset = useCallback(() => {
        cancelAnimationFrame(rafRef.current);
        fullRef.current = '';
        shownRef.current = 0;
        pausedRef.current = false;
        setText('');
        setStatus('idle');
    }, []);

    useEffect(() => {
        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [tick]);

    return { text, status, push, pause, resume, stop, reset };
}

// ---- 配套光标 CSS（只动合成层属性，并尊重减弱动效偏好）----
// .ai-caret::after { content: '▍'; margin-left: 1px;
//   animation: caret-blink 1s steps(1) infinite; }
// @keyframes caret-blink { 50% { opacity: 0; } }
// @media (prefers-reduced-motion: reduce) { .ai-caret::after { animation: none; } }
//
// ---- 字形安全：需要精确按 emoji 吐字时 ----
// const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
// [...segmenter.segment('你好👨‍👩‍👧')].map((s) => s.segment);
