/**
 * 57-02-custom-directives.ts —— 自定义指令逻辑单元测试
 * 运行方式: npx tsx examples/57-02-custom-directives.ts
 */

export function createPermissionDirective(
  getPermissions: () => string[],
  mode: "remove" | "disable" = "remove"
) {
  return {
    mounted(el: { remove: () => void; setAttribute: (k: string, v: string) => void; style: { cssText?: string; opacity?: string; pointerEvents?: string } },
              binding: { value: string | string[] }) {
      const required = Array.isArray(binding.value) ? binding.value : [binding.value];
      const userPerms = getPermissions();
      const hasAll = required.every((r) => userPerms.includes(r));
      if (!hasAll) {
        if (mode === "remove") {
          el.remove();
        } else {
          el.setAttribute("disabled", "true");
          el.style.opacity = "0.5";
          el.style.pointerEvents = "none";
        }
      }
    },
  };
}

export function runDirectiveTests() {
  const perms = ["user:read", "user:list"];
  const dir = createPermissionDirective(() => perms, "remove");

  // 无权限
  let removed = false;
  const mockEl: { remove: () => void; setAttribute: (k: string, v: string) => void; style: { opacity?: string; pointerEvents?: string } } = {
    remove() { removed = true; },
    setAttribute: () => {},
    style: {},
  };
  dir.mounted(mockEl, { value: "admin:delete" });
  console.assert(removed, "v-permission:无权限应移除");

  // 有权限
  removed = false;
  dir.mounted({ remove() { removed = true; }, setAttribute: () => {}, style: {} } as any, { value: "user:read" });
  console.assert(!removed, "v-permission:有权限不应移除");

  // AND 语义
  removed = false;
  dir.mounted({ remove() { removed = true; }, setAttribute: () => {}, style: {} } as any, { value: ["user:read", "admin:delete"] });
  console.assert(removed, "v-permission:AND 缺一即无权限");

  console.log("✅ v-permission 指令逻辑测试通过");
}

runDirectiveTests();
