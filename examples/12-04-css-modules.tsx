// 文件: examples/12-04-css-modules.tsx —— CSS Modules:构建期隔离,零运行时
import styles from './Button.module.css';

export function Button({ variant }: { variant: 'primary' | 'ghost' }) {
    // 类名被哈希为 Button_primary__x7f2a,天然不冲突
    return <button className={`${styles.btn} ${styles[variant]}`}>提交</button>;
}

// Button.module.css:
// .btn { padding: 8px 16px; border-radius: 6px; }
// .primary { background: var(--color-primary); color: #fff; }
// .ghost { background: transparent; border: 1px solid var(--color-primary); }
