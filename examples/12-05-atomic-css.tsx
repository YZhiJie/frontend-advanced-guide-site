// 文件: examples/12-05-atomic-css.tsx —— 原子化 CSS(Tailwind 风格):类名即样式
// 无需任何 css 文件;产物只包含用到的原子类,Gzip 后体积极小
export function UserBadge({ name, online }: { name: string; online: boolean }) {
    return (
        <span
            className={[
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm',
                online ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500',
            ].join(' ')}
        >
            {/* 条件样式 = 条件类名,配合 clsx/cn 工具函数更优雅 */}
            <span className={`size-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-gray-400'}`} />
            {name}
        </span>
    );
}
