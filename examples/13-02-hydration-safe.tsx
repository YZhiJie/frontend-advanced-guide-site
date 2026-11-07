// 文件: examples/13-02-hydration-safe.tsx —— 三种"浏览器才有"数据的安全写法
import { useEffect, useState, useSyncExternalStore } from 'react';

// ❌ 危险:直接渲染当前时间,服务端与客户端必然不同 → mismatch
// function Clock() { return <span>{new Date().toLocaleTimeString()}</span>; }

// ✅ 写法一:首帧渲染占位,mount 后再同步真实值(牺牲首帧准确性,换稳定性)
export function ClockSafe() {
    const [time, setTime] = useState<string>('--:--:--'); // 服务端与客户端首帧一致
    useEffect(() => {
        const id = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
        return () => clearInterval(id);
    }, []);
    return <span>{time}</span>;
}

// ✅ 写法二:useSyncExternalStore —— 官方为"外部数据源"设计的 SSR 安全 API
// getSnapshot 在服务端返回固定快照,getServerSnapshot 消除 mismatch
function subscribe(callback: () => void) {
    window.addEventListener('resize', callback);
    return () => window.removeEventListener('resize', callback);
}
export function WindowWidth() {
    const width = useSyncExternalStore(
        subscribe,
        () => window.innerWidth,        // 客户端快照
        () => 0,                        // 服务端快照(固定值,避免不一致)
    );
    return <span>窗口宽度: {width || '测量中...'}px</span>;
}
