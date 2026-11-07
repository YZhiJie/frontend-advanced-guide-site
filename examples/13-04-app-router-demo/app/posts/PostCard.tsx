// 文件: examples/13-04-app-router-demo/app/posts/PostCard.tsx
'use client'; // 交互边界:从这里开始的子树是客户端组件
import { useState } from 'react';

export function PostCard({ id, title }: { id: number; title: string }) {
    const [liked, setLiked] = useState(false);
    return (
        <article onClick={() => setLiked(!liked)}>
            <h3>{title}</h3>
            <button>{liked ? '❤️' : '🤍'} {id}</button>
        </article>
    );
}
