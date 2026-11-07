// 文件: examples/15-03-focus-trap.tsx —— 模态框焦点陷阱:可访问组件的标配
import { useEffect, useRef } from 'react';

export function Modal({ open, onClose, title, children }: {
    open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const dialog = dialogRef.current!;
        const previousFocus = document.activeElement as HTMLElement; // 记住打开前的焦点位置

        // 打开时把焦点移进对话框(键盘用户从第一个控件开始操作)
        const focusables = dialog.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        focusables[0]?.focus();

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') return onClose();
            if (e.key !== 'Tab') return;
            // Tab 循环:焦点始终困在对话框内(focus trap)
            const list = [...dialog.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            )];
            const first = list[0];
            const last = list[list.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();               // Shift+Tab 在第一个元素 → 跳到最后
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();              // Tab 在最后一个元素 → 跳回第一个
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            previousFocus?.focus();         // 关闭后焦点归位 —— 这是"黑洞"问题的解药
        };
    }, [open, onClose]);

    if (!open) return null;
    return (
        // role="dialog" + aria-modal:读屏宣布"进入了对话框",并屏蔽背后内容
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={title}>
            <h2>{title}</h2>
            {children}
            <button onClick={onClose}>关闭</button>
        </div>
    );
}
