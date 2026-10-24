// 文件: examples/09-04-counter.test.tsx —— Testing Library 全特性示例
// @ts-nocheck —— 示意代码:依赖 @testing-library/react、@testing-library/user-event、react,本仓库 examples 不安装这些包,实际项目需安装。详见 09-testing.md 9.3 节。
//
// 涵盖:getByRole/getByText 查询、userEvent 点击、连续交互、findBy 异步等待、
//       role="alert" 断言、mock 函数调用断言

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

// ============================ 被测组件(内联) ============================
function Counter({ initial = 0 }: { initial?: number }) {
    const [count, setCount] = useState(initial);
    return (
        <div>
            <p>当前计数:{count}</p>
            <button onClick={() => setCount((c) => c + 1)}>增加</button>
            <button onClick={() => setCount(initial)}>重置</button>
        </div>
    );
}

function LoginForm({ onLogin }: { onLogin: (u: string, p: string) => Promise<void> }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const submit = async (e: { preventDefault: () => void }) => {
        e.preventDefault();
        setLoading(true); setError('');
        try {
            await onLogin(
                (document.getElementById('u') as HTMLInputElement).value,
                (document.getElementById('p') as HTMLInputElement).value,
            );
        } catch {
            setError('登录失败,请重试');
        } finally { setLoading(false); }
    };
    return (
        <form onSubmit={submit}>
            <label>用户名<input id="u" /></label>
            <label>密码<input id="p" type="password" /></label>
            <button type="submit" disabled={loading}>{loading ? '登录中…' : '登录'}</button>
            {error && <p role="alert">{error}</p>}
        </form>
    );
}
// =====================================================================

describe('Counter 组件', () => {
    it('渲染初始值', () => {
        render(<Counter initial={5} />);
        expect(screen.getByText('当前计数:5')).toBeInTheDocument();
    });

    it('点击增加按钮后计数 +1(异步交互用 userEvent)', async () => {
        render(<Counter />);
        await userEvent.click(screen.getByRole('button', { name: '增加' }));
        expect(screen.getByText('当前计数:1')).toBeInTheDocument();
    });

    it('连续点击三次后为 3,重置后回到初始值', async () => {
        render(<Counter initial={10} />);
        const inc = screen.getByRole('button', { name: '增加' });
        await userEvent.click(inc);
        await userEvent.click(inc);
        await userEvent.click(inc);
        expect(screen.getByText('当前计数:13')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: '重置' }));
        expect(screen.getByText('当前计数:10')).toBeInTheDocument();
    });
});

describe('LoginForm 组件', () => {
    it('登录中显示 loading 文案,失败后显示错误提示', async () => {
        const onLogin = vi.fn().mockRejectedValue(new Error('fail'));
        render(<LoginForm onLogin={onLogin} />);
        await userEvent.type(screen.getByLabelText('用户名'), 'alice');
        await userEvent.type(screen.getByLabelText('密码'), 'pass');
        await userEvent.click(screen.getByRole('button', { name: '登录' }));

        // 异步文案:findBy 自带等待,绝不手写 setTimeout
        expect(await screen.findByRole('button', { name: '登录中…' })).toBeDisabled();
        expect(await screen.findByRole('alert')).toHaveTextContent('登录失败');
        expect(onLogin).toHaveBeenCalledWith('alice', 'pass');
    });
});
