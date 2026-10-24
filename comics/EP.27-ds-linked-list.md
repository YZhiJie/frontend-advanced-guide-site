# EP.27 链表指针舞

> 对应正文：[22-frontend-data-structures.md](../22-frontend-data-structures.md)（22.3 链表：不连续内存的优雅连接）· 示例：`data-structures/examples/22-03-linked-list.ts`

## 剧情回顾

- **第 1 格**：像素酱十万行列表中间 `splice` 插入一条，后面元素集体后移，主线程被占满，动画掉帧。
- **第 2 格**：码叔揭秘——链表节点散落各处，靠 `next` 指针串联；插入只改两根指针，O(1) 搞定。
- **第 3 格**：像素酱实证反转链表三指针：`prev/curr/next` 依次翻箭头，原 `1→2→3→null` 变成 `null←1←2←3`。
- **第 4 格**：码叔结案——Fiber/LRU/keep-alive 都是链表；改指针前先存 next，边界判空，快慢指针判环。

## 知识点拆解

### 第 1 格 · 数组中间插入为什么慢

- 数组连续内存，通过下标计算地址，读取 O(1)；
- 中间插入或删除会触发后续元素整片前移或后移，O(n)；
- 十万级列表配合频繁增删，必掉帧，链表才是这类场景的解。

### 第 2 格 · 链表结构

```ts
class Node<T> {
  value: T
  next: Node<T> | null = null
}
```

- 单链表：每个节点 `value + next`，物理位置不连续，逻辑顺序靠指针串；
- 插入新节点：先找到前驱 `prev`，`newNode.next = prev.next`，再 `prev.next = newNode`；
- 删除：`prev.next = prev.next.next`，跳过一个节点即可；
- 代价：查找第 i 个元素必须从头走 i 步，无法随机访问，是 O(n)。

### 第 3 格 · 反转链表三步走

```ts
function reverseList<T>(head: Node<T> | null) {
  let prev = null
  let curr = head
  while (curr) {
    const next = curr.next   // ① 先存下一棒
    curr.next = prev         // ② 调转箭头
    prev = curr              // ③ 三人各进一步
    curr = next
  }
  return prev
}
```

- **next 必须先存**：否则一改 `curr.next` 就断链，再也找不到原来的后续；
- 终止条件 `curr === null`：新链表的 tail 是 `null`，此时 `prev` 就是新头。

### 第 4 格 · 链表在前端

- **React Fiber**：用链表代替递归树，可中断、可恢复、可优先级调度；
- **LRU 缓存**：哈希表 + 双向链表，查找 O(1)、移动 O(1)；
- **keep-alive 缓存**：Vue 用链表维护缓存实例，按策略淘汰末端。

## 坑点清单

> 🔗 正文对照：[《22.11 本章避坑清单》](../22-frontend-data-structures#_22-11-本章避坑清单)

1. 改 `next` 前先存 `next`：反转/删除时一旦断链，后续节点永久丢失；
2. 快慢指针判环：`slow` 走一步、`fast` 走两步，相遇则有环；配合 Floyd 判环算法求入环点；
3. `head` 为空：`reverseList(null)` 应直接返回 `null`，否则 `curr.next` 报错；
4. 单向链表不好找前驱：删除当前节点只能做"狸猫换太子"（与 next 互换值，删 next），或改用双向链表。

## 自测 3 题（含答案）

1. **链表插入 O(1) 但数组是 O(n)，为什么？**——数组连续内存，中间插入需要后续元素全体搬家；链表只改前后两根指针指向，不移动任何数据，所以是 O(1)。
2. **反转链表为什么要先存 next 再掉头？**——因为 `curr.next = prev` 会覆盖原 `next`，如果不先保存，后面的节点就永远失联了。
3. **快慢指针怎么判断链表有环？**——`fast` 每次走两步、`slow` 每次走一步，无环时 `fast` 先到 null；有环时两者一定会在环内相遇。
