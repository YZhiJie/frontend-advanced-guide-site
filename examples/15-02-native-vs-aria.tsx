// 文件: examples/15-02-native-vs-aria.tsx —— 原生优先的第二课:别用 div 造按钮
// ❌ 反例:div 造按钮 —— 键盘无法聚焦,读屏不报"按钮",需要补一堆 ARIA + 键盘事件
// <div role="button" tabIndex={0} onClick={save}
//      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && save()}>保存</div>

// ✅ 正例:一行原生 button,上述能力全部免费
export function SaveButton() {
    return <button onClick={save}>保存</button>;
}
declare function save(): void;

// ARIA 只在原生语义不存在时使用:比如"用 div 组合出的树形控件/标签页组"
// 记住公式:原生元素 > 原生元素 + 属性增强 > ARIA + 手写交互
