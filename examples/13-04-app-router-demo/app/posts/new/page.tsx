// 文件: examples/13-04-app-router-demo/app/posts/new/page.tsx
import { createPost } from '../actions';

export default function NewPostPage() {
    return (
        // action 直接绑定服务端函数:渐进增强,JS 未加载完也能提交
        <form action={createPost}>
            <input name="title" required />
            <button type="submit">发布</button>
        </form>
    );
}
