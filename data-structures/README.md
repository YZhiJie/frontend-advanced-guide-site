# data-structures/ · 前端数据结构与算法专用目录

> 本目录是「第二十二部分：前端常用数据结构与算法」的**专用资源目录**，用于单独收纳该模块的示例代码、面试训练题与静态资源，避免与仓库根目录及其他部分（`comics/`、`examples/`）的既有资产混杂。

## 1. 用途

| 资产 | 位置 | 说明 |
| ---- | ---- | ---- |
| 主教程文档 | `../22-frontend-data-structures.md` | 遵循仓库根目录 `NN-名称.md` 编号惯例，不入本目录 |
| 配套漫画 | `../comics/EP.26` ~ `EP.32` | 漫画剧场为全系列统一资产（manifest.json 驱动阅读器），不入本目录 |
| 可运行示例 | `examples/`（本目录） | 与主文档 22.2~22.9 小节一一对应 |
| 面试题专项 | `interview/`（预留） | 高频题多解对照、口头表述稿、追问清单 |
| 静态资源 | `assets/`（预留） | 复杂度曲线图、演示数据、可视化帧 |

设计取舍：主文档与漫画**不**移入本目录——前者受根目录编号惯例约束（总目录、附录交叉引用均按 `NN-*.md` 寻址），后者受漫画剧场统一管线约束（`comics/manifest.json` 清单 + `comics/index.html` 阅读器 + `comics/check-comics.mjs` 校验器均以 `comics/` 为唯一根）。本目录只收纳**模块私有、可独立演进**的资源。

## 2. 结构设计

```
data-structures/
├── README.md            # 本文件：用途、结构设计、命名规范与扩展指南
├── examples/            # 可运行示例：零依赖 TypeScript，npx tsx 直跑，内置 console.assert 自测
├── interview/           # 面试题专项训练（预留子目录：多解对照 / 口述稿 / 追问清单）
└── assets/              # 可视化与静态资源（预留子目录：复杂度曲线 / 演示数据 / 可视化帧）
```

扩展性约定：

- **新增功能模块**（如「位运算」「字符串匹配 KMP」「并查集」）：主文档新增小节 → `examples/` 按编号递增新增示例 → 如需多题训练再启用 `interview/` → 同步更新本 README 第 3 节索引表。
- **新增子目录**前先在本文件登记用途，杜绝无文档的目录。
- `interview/` 与 `assets/` 当前以 `.gitkeep` 占位，启用时删除占位文件并补充各自的小 README。

## 3. 示例索引与命名规范

命名规范：`22-NN-slug.ts`——`NN` 为两位序号，与主文档小节顺序一致；`slug` 全小写连字符。每个示例**零外部依赖**、文件头注明对应小节、末尾以 `console.assert` 自测，保证 `npx tsx` 退出码为 0。

| 文件 | 对应小节 | 内容 |
| ---- | ---- | ---- |
| `examples/22-01-stack.ts` | 22.2 | 栈封装 / 有效括号 / 十进制转二进制 / 逆波兰求值 / 浏览器历史 |
| `examples/22-02-queue.ts` | 22.2 | 队列 / 环形队列 / 双端队列 / 滑动窗口最大值 / 两栈实现队列 / 击鼓传花 |
| `examples/22-03-linked-list.ts` | 22.3 | 单向链表 CRUD / 反转三法 / 快慢指针判环 / 双向链表 |
| `examples/22-04-hash-table.ts` | 22.4 | 链地址哈希表 / 质数容量 / 扩容缩容 / LRU（Map 版） |
| `examples/22-05-bst.ts` | 22.5 | BST 插入 / 查找 / 四种遍历 / 最值 / 删除三情形 |
| `examples/22-06-avl.ts` | 22.5 | AVL 平衡因子 / 四种旋转 / 与 BST 性能对照 |
| `examples/22-07-heap.ts` | 22.6 | 大顶堆 / 小顶堆 / 优先级队列 / TopK |
| `examples/22-08-graph.ts` | 22.7 | 邻接表 / BFS / DFS / Kahn 拓扑排序 / 循环依赖检测 |
| `examples/22-09-sorting.ts` | 22.8 | 十大排序实现 + `performance.now` 实测对比 |
| `examples/22-10-dp.ts` | 22.9 | 斐波那契四解 / 跳台阶 / 股票 / 最大子数组 / LIS 双解 |

运行方式（需 Node.js ≥ 18）：

```bash
npx tsx data-structures/examples/22-01-stack.ts
```

## 4. 维护规范

1. 示例改动后必须重新执行对应文件确认退出码为 0；
2. 新增示例须同步三处：主文档对应小节的示例链接、本 README 第 3 节索引表、根 `README.md` 更新记录；
3. 漫画相关改动走 `../comics/style-guide.md` 与 `check-comics.mjs` 校验，不在本目录另立标准。
