// 文件: examples/12-08-typed-tokens.ts —— 令牌的 TypeScript 化(呼应 2.4)
// 单一定义源:CSS 变量名与 TS 类型互相约束,重命名令牌时编译期立刻暴露

const tokens = {
    colorPrimary: '#1890ff',
    colorText: '#1f1f1f',
    fontSizeSm: '12px',
    fontSizeLg: '20px',
} as const;

type TokenName = keyof typeof tokens;                                   // 'colorPrimary' | ...
type CssVar = `--${TokenName}`;                                         // '--colorPrimary' | ...

// 运行时:生成 style 对象;编译期:注意不要用 as 断言 —— 有了它缺键/拼错都会被放过
export function tokenVars(): Record<CssVar, string> {
    return {
        '--colorPrimary': tokens.colorPrimary,
        '--colorText': tokens.colorText,
        '--fontSizeSm': tokens.fontSizeSm,
        '--fontSizeLg': tokens.fontSizeLg,
        // '--colorPrimay': ..., ← 拼错键:❌ 编译报错(不在 CssVar 中)
        // 缺掉任何一个键也会编译报错 —— 映射类型强制"每个 token 都有对应变量"
    };
}

// React 中挂载到根元素:
// <div style={tokenVars()}>...</div>
console.log(tokenVars());
