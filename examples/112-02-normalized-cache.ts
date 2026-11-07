// 文件: examples/112-02-normalized-cache.ts
// 归一化缓存：实体按 __typename:id 存取、字段引用同一对象、失效与乐观更新回滚
// 目标：同一实体多入口读写不串数据、回滚能精确还原、缺 id 的实体直接拒绝

import assert from 'node:assert';

interface Entity {
    __typename: string;
    id: string;
    [field: string]: unknown;
}

interface Snapshot {
    entities: Map<string, Entity>;
    fields: Map<string, string[]>;
}

function cloneEntities(source: Map<string, Entity>): Map<string, Entity> {
    const copy = new Map<string, Entity>();
    for (const [key, entity] of source) copy.set(key, { ...entity });
    return copy;
}

function cloneFields(source: Map<string, string[]>): Map<string, string[]> {
    const copy = new Map<string, string[]>();
    for (const [key, refs] of source) copy.set(key, [...refs]);
    return copy;
}

class NormalizedCache {
    private entities = new Map<string, Entity>();
    private fields = new Map<string, string[]>();
    private optimisticStack: Snapshot[] = [];

    static keyOf(entity: Entity): string {
        return `${entity.__typename}:${entity.id}`;
    }

    get size(): number {
        return this.entities.size;
    }

    get optimisticDepth(): number {
        return this.optimisticStack.length;
    }

    /** 写入字段引用：实体必须带 __typename + id，否则无法归一化 */
    writeField(fieldKey: string, entities: Entity[]): void {
        const keys = entities.map((entity) => {
            if (!entity.__typename || !entity.id) {
                throw new Error(`字段 ${fieldKey} 的实体缺少 __typename 或 id，禁止写入归一化缓存`);
            }
            const key = NormalizedCache.keyOf(entity);
            const existing = this.entities.get(key);
            // 局部响应只带部分字段：合并而不是覆盖，避免详情查询把列表字段抹掉
            this.entities.set(key, existing ? { ...existing, ...entity } : { ...entity });
            return key;
        });
        this.fields.set(fieldKey, keys);
    }

    readField(fieldKey: string): Array<Entity | null> {
        const keys = this.fields.get(fieldKey) ?? [];
        return keys.map((key) => this.entities.get(key) ?? null);
    }

    readEntity(key: string): Entity | undefined {
        return this.entities.get(key);
    }

    updateEntity(key: string, patch: Record<string, unknown>): void {
        const entity = this.entities.get(key);
        assert.ok(entity, `实体 ${key} 不存在，无法更新`);
        this.entities.set(key, { ...entity, ...patch });
    }

    /** 实体失效：删除记录但保留字段引用，读取时得到 null，便于标记洞 */
    invalidateEntity(key: string): boolean {
        return this.entities.delete(key);
    }

    /** 字段失效：清掉整个字段的引用列表 */
    invalidateField(fieldKey: string): void {
        this.fields.delete(fieldKey);
    }

    isFieldComplete(fieldKey: string): boolean {
        const keys = this.fields.get(fieldKey) ?? [];
        return keys.every((key) => this.entities.has(key));
    }

    beginOptimistic(): void {
        this.optimisticStack.push({
            entities: cloneEntities(this.entities),
            fields: cloneFields(this.fields),
        });
    }

    commit(): void {
        const snapshot = this.optimisticStack.pop();
        assert.ok(snapshot, '没有待提交的乐观更新');
    }

    rollback(): void {
        const snapshot = this.optimisticStack.pop();
        assert.ok(snapshot, '没有待回滚的乐观更新');
        this.entities = snapshot.entities;
        this.fields = snapshot.fields;
    }
}

function product(id: string, title: string, price: number): Entity {
    return { __typename: 'Product', id, title, price, likeCount: 0, likedByMe: false };
}

function runAssertions() {
    const cache = new NormalizedCache();

    // ---------- 测试 1：归一化去重——同一商品出现在两个列表，只存一份 ----------
    cache.writeField('ROOT_QUERY.featured', [product('p1', 'Hoodie', 59), product('p2', 'Sneaker', 89)]);
    cache.writeField('ROOT_QUERY.bestsellers', [product('p1', 'Hoodie', 59), product('p3', 'Cap', 25)]);
    assert.equal(cache.size, 3, '三个不重复商品只应存三份实体');
    assert.deepEqual(
        cache.readField('ROOT_QUERY.featured').map((entity) => entity?.id),
        ['p1', 'p2'],
    );
    assert.deepEqual(
        cache.readField('ROOT_QUERY.bestsellers').map((entity) => entity?.id),
        ['p1', 'p3'],
    );
    console.log('[1/4] 归一化去重 OK, 实体数:', cache.size);

    // ---------- 测试 2：引用一致性——详情查询补字段，两个入口读到同一个对象 ----------
    cache.writeField('ROOT_QUERY.product(id:"p1")', [
        { __typename: 'Product', id: 'p1', description: 'Heavyweight cotton', rating: 4.6 },
    ]);
    const fromList = cache.readField('ROOT_QUERY.featured')[0];
    const fromDetail = cache.readEntity('Product:p1');
    assert.equal(fromList, fromDetail, '同一实体在不同字段下必须共享同一个对象引用');
    assert.equal(fromDetail?.description, 'Heavyweight cotton', '详情字段应合并进已有实体');
    assert.equal(fromDetail?.title, 'Hoodie', '列表已有字段不应被局部响应覆盖丢失');
    const p2 = cache.readEntity('Product:p2');
    const p3 = cache.readEntity('Product:p3');
    assert.equal(p2?.title, 'Sneaker');
    assert.equal(p3?.title, 'Cap', '同名字段不得串数据');
    console.log('[2/4] 引用一致性 OK, p1 字段数:', Object.keys(fromDetail ?? {}).length);

    // ---------- 测试 3：失效——实体删除留洞、字段失效清引用、缺 id 写入被拒绝 ----------
    assert.equal(cache.isFieldComplete('ROOT_QUERY.featured'), true);
    assert.equal(cache.invalidateEntity('Product:p2'), true);
    const featured = cache.readField('ROOT_QUERY.featured');
    assert.equal(featured[1], null, '失效实体在引用位置应读出 null');
    assert.equal(cache.isFieldComplete('ROOT_QUERY.featured'), false, '存在洞的字段应标记为不完整');
    cache.invalidateField('ROOT_QUERY.bestsellers');
    assert.deepEqual(cache.readField('ROOT_QUERY.bestsellers'), [], '字段失效后引用列表为空');
    assert.throws(
        () => cache.writeField('ROOT_QUERY.search', [{ __typename: 'Product', id: '', title: 'Ghost' }]),
        /缺少 __typename 或 id/,
        '没有稳定 id 的实体写入必须抛错，否则会按字段名串数据',
    );
    console.log('[3/4] 失效与守卫 OK, featured 完整:', cache.isFieldComplete('ROOT_QUERY.featured'));

    // ---------- 测试 4：乐观更新——失败精确回滚、成功提交、服务端重取覆盖 ----------
    cache.writeField('ROOT_QUERY.product(id:"p1")', [product('p1', 'Hoodie', 59)]);
    const before = cache.readEntity('Product:p1');
    assert.equal(before?.likeCount, 0);

    cache.beginOptimistic();
    cache.updateEntity('Product:p1', { likeCount: 1, likedByMe: true });
    assert.equal(cache.readEntity('Product:p1')?.likeCount, 1, '乐观更新应立即生效');
    cache.rollback(); // 模拟点赞请求 500
    assert.equal(cache.readEntity('Product:p1')?.likeCount, 0, '回滚后必须精确还原');
    assert.equal(cache.readEntity('Product:p1')?.likedByMe, false);
    assert.equal(cache.optimisticDepth, 0, '回滚后快照栈必须清空');

    cache.beginOptimistic();
    cache.updateEntity('Product:p1', { likeCount: 1, likedByMe: true });
    cache.commit(); // 模拟请求成功
    assert.equal(cache.readEntity('Product:p1')?.likeCount, 1);
    assert.equal(cache.optimisticDepth, 0);

    cache.writeField('ROOT_QUERY.product(id:"p1")', [{ __typename: 'Product', id: 'p1', likeCount: 7 }]);
    assert.equal(cache.readEntity('Product:p1')?.likeCount, 7, '提交后的服务端数据应覆盖本地乐观值');
    assert.equal(cache.readEntity('Product:p1')?.likedByMe, true, '未返回的字段保留本地值');
    console.log('[4/4] 乐观更新回滚/提交 OK, 最终 likeCount:', cache.readEntity('Product:p1')?.likeCount);

    console.log('\n✅ 112-02 归一化缓存 全部断言通过');
}

runAssertions();
