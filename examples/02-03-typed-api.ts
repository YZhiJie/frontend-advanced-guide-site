// 文件: examples/02-03-typed-api.ts
// ============ 用泛型 + 映射类型搭建"类型安全"的前端 API 层 ============
// 思路:接口路径、方法、请求/响应类型集中在一张表里,请求函数全部自动推导

type User = { id: string; name: string; age: number };

// API 蓝图:单一定义源(single source of truth)
interface ApiMap {
    '/user': {
        GET: { res: User };
        POST: { body: Omit<User, 'id'>; res: User };
        DELETE: { res: { ok: boolean } };
    };
    '/user/list': {
        GET: { res: User[]; query: { page: number; size: number } };
    };
}

// 从蓝图中提取查询参数:没有 query 字段时返回 undefined
type QueryOf<P extends keyof ApiMap> = ApiMap[P] extends { GET: { query: infer Q } } ? Q : undefined;
type BodyOf<P extends keyof ApiMap, M extends keyof ApiMap[P]> = ApiMap[P][M] extends { body: infer B } ? B : undefined;
type ResOf<P extends keyof ApiMap, M extends keyof ApiMap[P]> = ApiMap[P][M]['res'];

async function request<P extends keyof ApiMap, M extends keyof ApiMap[P]>(
    path: P,
    method: M,
    options?: { query?: QueryOf<P>; body?: BodyOf<P, M> },
): Promise<ResOf<P, M>> {
    const query = options?.query ? `?${new URLSearchParams(Object.entries(options.query).map(([k, v]) => [k, String(v)]))}` : '';
    const res = await fetch(String(path) + query, {
        method: String(method),
        body: options?.body ? JSON.stringify(options.body) : undefined,
    });
    return res.json() as Promise<ResOf<P, M>>;
}

// 调用处全部自动推导,改接口蓝图时调用处会立刻报错
async function demo() {
    const list = await request('/user/list', 'GET', { query: { page: 1, size: 10 } }); // User[]
    console.log(list.length);
    const created = await request('/user', 'POST', { body: { name: 'Alice', age: 18 } }); // User
    console.log(created.id);
}
void demo;
