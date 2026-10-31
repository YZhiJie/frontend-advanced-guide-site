// 文件: examples/19-05-tree-utils.ts
// ============ 树结构四件套:扁平化 / 数组转树 / 查找节点 / 关键字过滤(保留祖先) ============
// 部门树、菜单树、级联选择、评论楼中楼——后端常给扁平数组,组件常要树形,
// 搜索时又要"自己命中或子孙命中都保留"。四个纯函数覆盖全部场景。

export interface TreeNode {
    id: number | string;
    parentId: number | string | null;
    name: string;
    children?: TreeNode[];
}

/** 树 -> 扁平数组(前序 DFS:父节点一定排在子孙前面) */
export function flattenTree(nodes: readonly TreeNode[]): TreeNode[] {
    const result: TreeNode[] = [];
    const walk = (list: readonly TreeNode[]): void => {
        for (const node of list) {
            result.push(node);
            if (node.children?.length) walk(node.children);
        }
    };
    walk(nodes);
    return result;
}

/**
 * 扁平数组 -> 树(两遍法,数据乱序也能正确挂载):
 * 第一遍全部入 Map;第二遍各自找父节点,找不到父(或父被过滤掉)的就是根。
 */
export function listToTree(list: readonly TreeNode[]): TreeNode[] {
    // ⚠️ 必须给每个节点新建 children 数组并克隆,直接改原数据会污染外部缓存
    const map = new Map<TreeNode['id'], TreeNode>();
    for (const item of list) map.set(item.id, { ...item, children: [] });

    const roots: TreeNode[] = [];
    for (const item of list) {
        const node = map.get(item.id) as TreeNode;
        if (item.parentId !== null && map.has(item.parentId)) {
            (map.get(item.parentId) as TreeNode).children?.push(node);
        } else {
            roots.push(node);
        }
    }
    // 叶子节点的空 children 删掉,避免组件把叶子渲染成展开箭头
    const stripEmpty = (nodes: TreeNode[]): void => {
        for (const n of nodes) {
            if (n.children?.length === 0) delete n.children;
            else if (n.children) stripEmpty(n.children);
        }
    };
    stripEmpty(roots);
    return roots;
}

/** 在树中按 id 查找单个节点(DFS) */
export function findNode(nodes: readonly TreeNode[], id: TreeNode['id']): TreeNode | null {
    for (const node of nodes) {
        if (node.id === id) return node;
        if (node.children?.length) {
            const hit = findNode(node.children, id);
            if (hit) return hit;
        }
    }
    return null;
}

/**
 * 求从根到目标节点的路径(含两端),用于级联选择器回显、面包屑。
 * 找不到返回 null。
 */
export function findPath(nodes: readonly TreeNode[], id: TreeNode['id']): TreeNode[] | null {
    const dfs = (list: readonly TreeNode[], trail: TreeNode[]): TreeNode[] | null => {
        for (const node of list) {
            const next = [...trail, node];
            if (node.id === id) return next;
            if (node.children?.length) {
                const hit = dfs(node.children, next);
                if (hit) return hit;
            }
        }
        return null;
    };
    return dfs(nodes, []);
}

/**
 * 树关键字过滤:
 * 节点自身命中,或其任意子孙命中,都保留(且保留中间路径),
 * 否则整枝剪掉。菜单搜索、组织架构搜索都用这个语义。
 */
export function filterTree(nodes: readonly TreeNode[], predicate: (node: TreeNode) => boolean): TreeNode[] {
    const walk = (list: readonly TreeNode[]): TreeNode[] => {
        const kept: TreeNode[] = [];
        for (const node of list) {
            const children = node.children ? walk(node.children) : undefined;
            if (predicate(node) || (children && children.length > 0)) {
                kept.push({ ...node, ...(children?.length ? { children } : {}) });
            }
        }
        return kept;
    };
    return walk(nodes);
}

// ---------------- 验证 ----------------

// 后端返回的扁平部门列表(注意顺序是乱的)
const flatDepts: TreeNode[] = [
    { id: 3, parentId: 2, name: '前端组' },
    { id: 1, parentId: null, name: '总部' },
    { id: 4, parentId: 2, name: '后端组' },
    { id: 2, parentId: 1, name: '技术中心' },
    { id: 5, parentId: 2, name: '测试组' },
    { id: 6, parentId: null, name: '分公司' },
];

const tree = listToTree(flatDepts);
console.log(JSON.stringify(tree, null, 2));
// 总部
//  ├─ 技术中心
//  │   ├─ 前端组
//  │   ├─ 后端组
//  │   └─ 测试组
// 分公司

// ---- 扁平化后父节点必在子孙之前 ----
console.log(flattenTree(tree).map((n) => n.name));
// ['总部', '技术中心', '前端组', '后端组', '测试组', '分公司']

// ---- 查找 ----
console.log(findNode(tree, 5)?.name); // '测试组'
console.log(findNode(tree, 999)); // null

// ---- 路径回显:前端组的面包屑 ----
console.log((findPath(tree, 3) ?? []).map((n) => n.name)); // ['总部', '技术中心', '前端组']

// ---- 关键字过滤:搜"组",命中子孙时祖先路径一并保留;分公司整枝被剪掉 ----
console.log(flattenTree(filterTree(tree, (n) => n.name.includes('组'))).map((n) => n.name));
// ['总部', '技术中心', '前端组', '后端组', '测试组']

// ---- 原数据不被污染 ----
console.log(flatDepts[0].children); // undefined
