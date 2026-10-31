// 文件: examples/15-05-aria-patterns.tsx —— 三个高频 ARIA 模式
import { useState } from 'react';

// ---- 模式一:折叠面板 —— 状态必须可感知 ----
export function Collapse({ title, children }: { title: string; children: React.ReactNode }) {
    const [open, setOpen] = useState(false);
    return (
        <div>
            <button
                aria-expanded={open}                       // 读屏朗读"已展开/已折叠"
                aria-controls="collapse-panel"             // 与受控区域关联
                onClick={() => setOpen(!open)}
            >
                {title} {open ? '▲' : '▼'}
            </button>
            {open && <div id="collapse-panel">{children}</div>}
        </div>
    );
}

// ---- 模式二:表单校验 —— 错误与输入框关联,读屏用户才能听到错误 ----
export function EmailField() {
    const [email, setEmail] = useState('');
    const [error, setError] = useState<string | null>(null);

    return (
        <div>
            <label htmlFor="email">邮箱</label>
            <input
                id="email"
                type="email"
                value={email}
                aria-invalid={error ? true : undefined}          // 标记无效状态
                aria-describedby={error ? 'email-error' : undefined} // 关联错误描述
                onChange={(e) => setEmail(e.target.value)}
            />
            {error && (
                <p id="email-error" role="alert">                {/* role=alert:立即播报 */}
                    {error}
                </p>
            )}
        </div>
    );
}

// ---- 模式三:live region —— 动态内容主动播报(toast/搜索结果/AI 生成进度) ----
export function SearchStatus({ count, done }: { count: number; done: boolean }) {
    return (
        // aria-live=polite:内容变化时等读屏空闲再播报(不打断);assertive 会打断,慎用
        <p aria-live="polite">
            {done ? `搜索完成,共 ${count} 条结果` : '搜索中...'}
        </p>
    );
}
