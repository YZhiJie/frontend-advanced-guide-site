// 文件: examples/13-04-app-router-demo/app/posts/page.tsx
// ============ App Router:服务端组件默认,直接 async 取数 ============
import { PostCard } from './PostCard';

export const revalidate = 60; // ISR:本路由 60 秒再生一次

export default async function PostsPage() {
    // ① 服务端组件可以直接 await —— 没有 useEffect/useState/loading 三件套
    // ② fetch 带缓存语义:相同 URL 的请求在渲染期间自动去重,60s 内命中缓存
    const res = await fetch('https://api.example.com/posts', { next: { revalidate: 60 } });
    const posts = (await res.json()) as { id: number; title: string }[];

    return (
        <main>
            <h1>文章列表(服务端渲染,零客户端 JS)</h1>
            {/* Server → Client:传可序列化 props */}
            {posts.map((p) => <PostCard key={p.id} id={p.id} title={p.title} />)}
        </main>
    );
}
