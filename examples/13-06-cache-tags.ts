// 文件: examples/13-06-cache-tags.ts —— 精准缓存与按需失效
import { revalidateTag } from 'next/cache';

// 读:带标签缓存(同一 tag 的所有请求共享)
async function getProducts() {
    const res = await fetch('https://api.example.com/products', {
        next: { tags: ['products'], revalidate: 300 }, // 5 分钟再生 + 标签
    });
    return res.json();
}

// 写:后台改了商品 → 精确失效带该标签的缓存(而不是全站刷新)
export async function POST() {
    await fetch('https://api.example.com/products', { method: 'POST', /* ... */ });
    revalidateTag('products');
}
