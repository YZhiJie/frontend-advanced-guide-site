// 文件: examples/13-04-app-router-demo/app/posts/actions.ts
// ============ Server Actions:表单提交不需要手写 API 端点 ============
'use server';
import { revalidatePath } from 'next/cache';

export async function createPost(formData: FormData) {
    const title = String(formData.get('title'));
    await db.post.create({ data: { title } }); // 服务端直连数据库(密钥不出服务器)
    revalidatePath('/posts');                  // 让列表路由的缓存失效并重新渲染
}
declare const db: { post: { create(args: { data: { title: string } }): Promise<unknown> } };
