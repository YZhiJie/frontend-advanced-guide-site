// @ts-nocheck
// 文件: examples/ai-interview/markdown-stream.tsx —— [浏览器/React] 流式 Markdown：降频 + 围栏补齐 + 块冻结 + 消毒
// 运行方式: 需 React 18+ / marked / dompurify（npm i marked dompurify）
// 关联文档: 21-frontend-ai-interview.md 21.5.5
import { useEffect, useRef, useState, memo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * ① 未闭合围栏保护：流式中 ``` 出现奇数次时，闭合 fence 还在路上，
 *    临时补一个让解析结果稳定（否则后续正文全被吃进代码块，颜色每帧横跳）。
 */
function stabilizeStreaming(src: string): string {
    const fences = src.match(/```/g)?.length ?? 0;
    return fences % 2 === 1 ? `${src}\n\`\`\`` : src;
}

/**
 * ② 降频 hook：文本高频变化时每 gap ms 才产出一次待渲染文本；
 *    流结束（streaming=false）立即终态渲染，保证最终结果 100% 正确。
 */
function useThrottledText(text: string, streaming: boolean, gap = 80): string {
    const [view, setView] = useState(text);
    const timer = useRef<ReturnType<typeof setTimeout>>();
    useEffect(() => {
        if (!streaming) {
            setView(text);
            return;
        }
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setView(text), gap);
        return () => clearTimeout(timer.current);
    }, [text, streaming, gap]);
    return view;
}

// ③ 已闭合块冻结：memo 让未变化的块不再重新生成/注入 HTML
const Block = memo(function Block({ html }: { html: string }) {
    return <div dangerouslySetInnerHTML={{ __html: html }} />;
});

export function StreamingMarkdown({ text, streaming }: { text: string; streaming: boolean }) {
    const throttled = useThrottledText(text, streaming);
    // 生产环境建议把 marked.parse 放进 Worker，主线程零阻塞
    const rawHtml = marked.parse(stabilizeStreaming(throttled), { async: false, gfm: true }) as string;
    // 按顶层闭合标签粗切块（演示思路；生产可用 token 级 AST 切块）
    const blocks = rawHtml
        .split(/(?<=<\/(?:p|pre|h\d|ul|ol|blockquote|table)>)/)
        .filter(Boolean)
        .map(
            (b) =>
                // ④ 消毒必须在所有变换之后、注入 DOM 之前：模型输出不可信，防 <img onerror> 等 XSS
                DOMPurify.sanitize(b, { ADD_ATTR: ['target'] }),
        );
    return (
        <div className="md-body">
            {blocks.map((html, i) => (
                <Block key={i} html={html} />
            ))}
            {streaming && <span className="ai-caret" aria-hidden="true" />}
        </div>
    );
}

// 安全补充：
// - react-markdown 用户配了 rehype-raw 就必须同时配 rehype-sanitize；
// - 链接渲染强制 target="_blank" rel="noopener noreferrer"，href 只允许 http/https/锚点；
// - Mermaid/Shiki 在块闭合后才执行，内容稳定前只显示纯 pre；高亮结果按内容 hash 缓存；
// - 超长会话：Worker 解析 + 块级 keyed diff + 虚拟列表（存 1000 渲染 60）。
