# EP.55 角色不是权限

> 对应正文：[第三十五部分 · 后台管理系统权限方案](../35-admin-system-auth.md#_35-1-rbac-权限模型-用户-→-角色-→-权限码)

## 剧情回顾

- **第 1 格**：标签君写了 `if (role === 'admin')` 来控制按钮显隐，结果后端新增「运营主管」角色时，前端又得改代码发版——角色名写死在前端，等于把后端的概念耦合进来了。
- **第 2 格**：码叔点破 RBAC 三层模型——用户不直接持有权限，而是通过「用户-角色」和「角色-权限」两张关系表间接获得。角色只是「权限的容器」，前端只应该识别权限码（`user:edit`），不应该出现角色名字符串。
- **第 3 格**：像素酱验证 `collectPermissions` 把多角色权限码合并去重，`hasPermission` 只认权限码——后端新增角色时，前端这两个函数零改动。
- **第 4 格**：码叔结案——超管别用 `*` 权限码（后端误删会把超管锁死），要用独立的 `isSuperAdmin` 字段；权限码用 `模块:资源:动作` 三级命名。

## 知识点拆解

### 第 1 格 · 写死角色名的反模式

```js
// ❌ 反模式：前端直接判断角色名
if (role === 'admin') {
  showDeleteBtn = true
}
```

角色是后端可以动态增删的概念。把角色名写死在前端判断里，后端每加一个角色（运营主管、审计、财务……），前端都要同步改判断逻辑并发版。正确的做法是前端只消费 `permissionCodes`。

### 第 2 格 · RBAC 三层模型

```
用户 Alice  →  角色 运营  →  权限码 [user:view, order:*]
   ↑              ↑                ↑
用户-角色表   角色-权限表       前端只认这个
```

这个间接层的价值是**可维护性**：给 100 个运营加一个权限，只改「运营角色」的一条记录，而不是改 100 个用户。前端的 `collectPermissions` 和 `hasPermission` 永远不需要因为新角色而改动。

### 第 3 格 · 权限码合并与判定

```ts
// 合并多角色的权限码（去重），超管直接返回 ["*"]
export function collectPermissions(user, roles) {
  if (user.isSuperAdmin) return ["*"];
  const set = new Set();
  for (const roleId of user.roleIds) {
    const role = roles.find(r => r.id === roleId);
    for (const code of role.permissionCodes) set.add(code);
  }
  return [...set];
}

// 判定：只认权限码，不认角色名
export function hasPermission(required, owned) {
  return owned.some(rule => matchRule(required, rule));
}

function matchRule(required, owned) {
  if (owned === "*") return true;
  if (required === owned) return true;
  if (owned.endsWith(":*"))
    return required.startsWith(owned.slice(0, -1)); // 前缀必须带冒号
  return false;
}
```

**防越权细节**：`startsWith` 的前缀必须带冒号——`user:*` 的前缀是 `user:`，这样 `user2:edit` 不会误匹配 `user:*`。

### 第 4 格 · 超管的正确姿势

| 错误做法 | 正确做法 |
| ---- | ---- |
| 给超管发 `*` 权限码 | 用 `isSuperAdmin` 布尔字段 |
| 超管走角色-权限表查询 | 超管在中间件直接放行 |
| 权限表误操作 → 超管被锁 | 超管身份不受权限表影响 |

## 坑点清单

> 🔗 正文对照：[《35.8 本章避坑清单》](../35-admin-system-auth#_35-8-本章避坑清单)

1. **前端判断角色名而非权限码**：`if (role === 'admin')` 导致新增角色必须改前端。只消费 `permissionCodes`，角色名不出现在前端逻辑里。
2. **超管用 `*` 权限码而非独立字段**：角色表误删 `*` 会导致超管降级被锁死。用 `isSuperAdmin` 布尔字段，判定层绕过权限码匹配。
3. **权限码用两级 `user:edit` 跨模块重名**：订单的 `view` 和用户的 `view` 冲突。用三级 `system:user:edit` / `biz:order:view`。
4. **`startsWith` 前缀不带冒号导致越权**：`user:*` 用 `startsWith("user")` 会让 `user2:edit` 误通过。前缀必须是 `user:`（带冒号）。

## 自测 3 题

**1. 为什么前端不应该直接判断 `role === 'admin'`，而应该判断权限码？**

<details>
<summary>参考答案</summary>

角色是后端可以动态增删的概念。如果前端把角色名写死在判断里，后端新增角色时前端必须同步改代码并发版。改为判断权限码后，后端只需在角色上挂载对应的权限码，前端零改动即可生效——角色是给人看的，权限码是给机器判的。
</details>

**2. `matchRule('user2:edit', 'user:*')` 应该返回 true 还是 false？为什么？**

<details>
<summary>参考答案</summary>

返回 **false**。`user:*` 表示「user 资源下的所有动作」，`user2:edit` 属于 `user2` 资源，不是 `user` 资源。实现时 `startsWith` 的前缀必须带冒号：`owned.slice(0, -1)` 得到 `user:`，`user2:edit` 不以 `user:` 开头，所以不匹配。如果前缀不带冒号（`user`），`user2:edit` 会误通过，造成越权。
</details>

**3. 超管为什么要用 `isSuperAdmin` 独立字段，而不是发一个 `*` 权限码？**

<details>
<summary>参考答案</summary>

如果超管身份依赖 `*` 权限码，后端在角色-权限表里误操作（批量回收、角色被删）会导致超管降级为普通用户，甚至把自己锁死在系统外。用独立字段 `isSuperAdmin` 后，超管身份在用户表层标记，不受角色-权限关系表影响，判定层直接绕过权限码匹配，更稳定也更安全。
</details>
