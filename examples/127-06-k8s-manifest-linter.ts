/**
 * 第 127 部分配套：Kubernetes 清单检查器
 * JD 需求点：能审出「滚动发布必中断、探针缺失、资源不限额、Ingress 指向不存在的
 *   Service、HPA 只配了 CPU 但没有行为约束」这类会在集群里放大成事故的问题。
 * 本示例读取 examples/deploy/k8s 下的四份真实清单：
 *   1) Deployment：副本数、滚动策略、三探针、resources、securityContext
 *   2) Service：selector 必须与 Pod labels 对得上
 *   3) Ingress：TLS + 后端 Service 必须真实存在
 *   4) HPA：autoscaling/v2 + 指标 + 缩容稳定窗口
 * 运行：npx tsx examples/127-06-k8s-manifest-linter.ts
 */
import assert from "node:assert";
import { readFileSync } from "node:fs";

interface Doc {
  source: string;
  kind: string;
  name: string;
  text: string;
}

interface Issue {
  level: "error" | "warn";
  rule: string;
  target: string;
  message: string;
}

function splitDocs(source: string): Doc[] {
  return source
    .split(/^---$/m)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text) => ({
      source,
      kind: text.match(/^kind:\s*(\S+)/m)?.[1] ?? "Unknown",
      name: text.match(/^metadata:\s*\n\s+name:\s*(\S+)/m)?.[1] ?? "unnamed",
      text,
    }));
}

function parseKv(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^\s*([\w./-]+):\s*(\S+)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function matchLabels(doc: Doc): Record<string, string> {
  const m = doc.text.match(/matchLabels:\s*\n((?:\s{6}[^\n]+\n)+)/);
  return m ? parseKv(m[1]) : {};
}

function podLabels(doc: Doc): Record<string, string> {
  const m = doc.text.match(/template:\s*\n\s+metadata:\s*\n\s+labels:\s*\n((?:\s{8}[^\n]+\n)+)/);
  return m ? parseKv(m[1]) : {};
}

function serviceSelector(doc: Doc): Record<string, string> {
  const m = doc.text.match(/^  selector:\s*\n((?:    [^\n]+\n)+)/m);
  return m ? parseKv(m[1]) : {};
}

function auditDeployments(docs: Doc[]): Issue[] {
  const issues: Issue[] = [];
  const err = (target: string, rule: string, message: string) =>
    issues.push({ level: "error", rule, target, message });
  const warn = (target: string, rule: string, message: string) =>
    issues.push({ level: "warn", rule, target, message });

  for (const d of docs.filter((x) => x.kind === "Deployment")) {
    const replicas = Number(d.text.match(/^  replicas:\s*(\d+)/m)?.[1] ?? 0);
    if (replicas < 2) err(d.name, "deploy.replicas", `副本数 ${replicas} < 2，滚动发布没有冗余`);

    if (!/type:\s*RollingUpdate/.test(d.text)) err(d.name, "deploy.strategy", "未声明 RollingUpdate");
    if (!/maxUnavailable:\s*0/.test(d.text)) {
      err(d.name, "deploy.max-unavailable", "maxUnavailable 不是 0，发布期间容量会下降");
    }
    if (!/maxSurge:\s*[1-9]/.test(d.text)) warn(d.name, "deploy.max-surge", "maxSurge 为 0 时扩容要先缩容，发布更慢");

    for (const probe of ["startupProbe", "readinessProbe", "livenessProbe"]) {
      if (!new RegExp(`${probe}:`).test(d.text)) err(d.name, "deploy.probe", `缺少 ${probe}`);
    }
    if (!/periodSeconds:\s*\d+/.test(d.text)) warn(d.name, "deploy.probe-period", "探针未设置 periodSeconds");

    const resources = d.text.match(/resources:[\s\S]{0,400}/)?.[0] ?? "";
    if (!/requests:/.test(resources)) err(d.name, "deploy.resources", "缺少 resources.requests（调度会失真）");
    if (!/limits:/.test(resources)) err(d.name, "deploy.resources", "缺少 resources.limits（会拖垮节点）");
    if (!/cpu:/.test(resources) || !/memory:/.test(resources)) {
      warn(d.name, "deploy.resources", "resources 未同时设置 cpu 与 memory");
    }

    if (!/runAsNonRoot:\s*true/.test(d.text)) err(d.name, "deploy.security", "未声明 runAsNonRoot");
    if (!/allowPrivilegeEscalation:\s*false/.test(d.text)) {
      err(d.name, "deploy.security", "未禁止 allowPrivilegeEscalation");
    }
    if (!/readOnlyRootFilesystem:\s*true/.test(d.text)) {
      warn(d.name, "deploy.security", "根文件系统可写，建议只读 + emptyDir 挂载");
    }
    if (!/drop:\s*\[?"?ALL/.test(d.text)) err(d.name, "deploy.security", "未 drop ALL capabilities");

    for (const img of d.text.matchAll(/image:\s*(\S+)/g)) {
      if (/:latest$/.test(img[1])) err(d.name, "deploy.image", `镜像使用了 latest：${img[1]}`);
    }

    const grace = Number(d.text.match(/terminationGracePeriodSeconds:\s*(\d+)/)?.[1] ?? 0);
    if (grace < 20) err(d.name, "deploy.grace", `terminationGracePeriodSeconds=${grace} 过短，连接会被硬切`);

    const selector = matchLabels(d);
    const labels = podLabels(d);
    if (Object.keys(selector).length === 0) err(d.name, "deploy.selector", "缺少 matchLabels");
    if (Object.keys(labels).length === 0) err(d.name, "deploy.labels", "Pod template 缺少 labels");
    for (const [k, v] of Object.entries(selector)) {
      if (labels[k] !== v) err(d.name, "deploy.selector-mismatch", `selector ${k}=${v} 与 Pod label ${labels[k] ?? "缺失"} 不一致`);
    }

    if (/(configMapRef|secretRef):/.test(d.text) && !/envFrom:/.test(d.text)) {
      err(d.name, "deploy.env", "使用了 configMapRef/secretRef 但不在 envFrom 下，写法可能无效");
    }
  }
  return issues;
}

function auditServices(docs: Doc[], deployments: Doc[]): Issue[] {
  const issues: Issue[] = [];
  for (const s of docs.filter((x) => x.kind === "Service")) {
    const selector = serviceSelector(s);
    const target = deployments.find((d) => d.kind === "Deployment" && d.name === s.name);
    if (!target) {
      issues.push({ level: "error", rule: "svc.target", target: s.name, message: "找不到同名 Deployment" });
      continue;
    }
    for (const [k, v] of Object.entries(selector)) {
      if (podLabels(target)[k] !== v) {
        issues.push({
          level: "error",
          rule: "svc.selector",
          target: s.name,
          message: `Service selector ${k}=${v} 匹配不到 Pod labels`,
        });
      }
    }
    if (!/targetPort:\s*http/.test(s.text)) {
      issues.push({ level: "warn", rule: "svc.port", target: s.name, message: "建议用命名端口 targetPort: http" });
    }
  }
  return issues;
}

function auditIngress(docs: Doc[], services: Doc[]): Issue[] {
  const issues: Issue[] = [];
  const ing = docs.find((d) => d.kind === "Ingress");
  if (!ing) return [{ level: "error", rule: "ingress.missing", target: "-", message: "缺少 Ingress" }];

  if (!/tls:/.test(ing.text) || !/secretName:/.test(ing.text)) {
    issues.push({ level: "error", rule: "ingress.tls", target: ing.name, message: "未配置 TLS 或 secretName" });
  }
  if (!/hosts:\s*\n\s+-\s+\S+/.test(ing.text)) {
    issues.push({ level: "error", rule: "ingress.host", target: ing.name, message: "TLS 未声明 hosts" });
  }
  const backends = [...ing.text.matchAll(/service:\s*\n\s+name:\s*(\S+)/g)].map((m) => m[1]);
  const serviceNames = new Set(services.map((s) => s.name));
  for (const b of backends) {
    if (!serviceNames.has(b)) {
      issues.push({ level: "error", rule: "ingress.backend", target: ing.name, message: `后端 Service ${b} 不存在` });
    }
  }
  if (!/pathType:\s*Prefix/.test(ing.text)) {
    issues.push({ level: "warn", rule: "ingress.path-type", target: ing.name, message: "建议显式 pathType: Prefix" });
  }
  if (backends.length < 2) {
    issues.push({ level: "warn", rule: "ingress.routes", target: ing.name, message: "只声明了一个后端，确认 /api 是否直达 BFF" });
  }
  return issues;
}

function auditHpa(docs: Doc[], deployments: Doc[]): Issue[] {
  const issues: Issue[] = [];
  const hpa = docs.find((d) => d.kind === "HorizontalPodAutoscaler");
  if (!hpa) return [{ level: "error", rule: "hpa.missing", target: "-", message: "缺少 HPA" }];

  if (!/apiVersion:\s*autoscaling\/v2/.test(hpa.text)) {
    issues.push({ level: "error", rule: "hpa.api", target: hpa.name, message: "必须使用 autoscaling/v2" });
  }
  const targetName = hpa.text.match(/scaleTargetRef:[\s\S]*?name:\s*(\S+)/)?.[1] ?? "";
  if (!deployments.some((d) => d.kind === "Deployment" && d.name === targetName)) {
    issues.push({ level: "error", rule: "hpa.target", target: hpa.name, message: `伸缩目标 ${targetName} 不存在` });
  }
  const min = Number(hpa.text.match(/minReplicas:\s*(\d+)/)?.[1] ?? 0);
  const max = Number(hpa.text.match(/maxReplicas:\s*(\d+)/)?.[1] ?? 0);
  if (min < 2) issues.push({ level: "error", rule: "hpa.min", target: hpa.name, message: "minReplicas < 2，单副本故障即不可用" });
  if (max <= min) issues.push({ level: "error", rule: "hpa.max", target: hpa.name, message: "maxReplicas 必须大于 minReplicas" });
  if (!/averageUtilization:\s*\d+/.test(hpa.text)) {
    issues.push({ level: "error", rule: "hpa.metric", target: hpa.name, message: "缺少 CPU 利用率指标" });
  }
  const stabilize = Number(hpa.text.match(/scaleDown:[\s\S]*?stabilizationWindowSeconds:\s*(\d+)/)?.[1] ?? 0);
  if (stabilize < 60) {
    issues.push({ level: "warn", rule: "hpa.behavior", target: hpa.name, message: "缩容稳定窗口过短，流量抖动会引发副本震荡" });
  }
  return issues;
}

function auditAll(sources: Record<string, string>): { docs: Doc[]; issues: Issue[] } {
  const docs = Object.values(sources).flatMap(splitDocs);
  const deployments = docs.filter((d) => d.kind === "Deployment");
  const services = docs.filter((d) => d.kind === "Service");
  return {
    docs,
    issues: [
      ...auditDeployments(docs),
      ...auditServices(docs, deployments),
      ...auditIngress(docs, services),
      ...auditHpa(docs, deployments),
    ],
  };
}

const SOURCES = {
  deployment: readFileSync("examples/deploy/k8s/deployment.yaml", "utf8"),
  service: readFileSync("examples/deploy/k8s/service.yaml", "utf8"),
  ingress: readFileSync("examples/deploy/k8s/ingress.yaml", "utf8"),
  hpa: readFileSync("examples/deploy/k8s/hpa.yaml", "utf8"),
};

// ===================== 运行断言 =====================
console.log("===== 1. 真实清单体检 =====");
const { docs, issues } = auditAll(SOURCES);
const errors = issues.filter((i) => i.level === "error");
assert.deepStrictEqual(
  errors,
  [],
  `清单存在 error：\n${errors.map((i) => `[${i.rule}] ${i.target}: ${i.message}`).join("\n")}`,
);
const kinds = docs.map((d) => `${d.kind}/${d.name}`);
console.log(`✓ ${docs.length} 个资源：${kinds.join(", ")}`);
console.log(`✓ error=0 / warn=${issues.filter((i) => i.level === "warn").length}`);

console.log("\n===== 2. 资源类型齐全 =====");
assert.strictEqual(docs.filter((d) => d.kind === "Deployment").length, 2, "应有 frontend 与 bff 两个 Deployment");
assert.strictEqual(docs.filter((d) => d.kind === "Service").length, 2, "应有 frontend 与 bff 两个 Service");
assert(docs.some((d) => d.kind === "Ingress"), "缺少 Ingress");
assert(docs.some((d) => d.kind === "HorizontalPodAutoscaler"), "缺少 HPA");
assert(docs.some((d) => d.kind === "ConfigMap") && docs.some((d) => d.kind === "Secret"), "配置与密钥应可注入");
console.log("✓ Deployment / Service / Ingress / HPA / ConfigMap / Secret 齐全");

console.log("\n===== 3. 逐项破坏，检查器必须定位 =====");
const mutations: { name: string; rule: string; mutate: (s: Record<string, string>) => Record<string, string> }[] = [
  {
    name: "maxUnavailable=1",
    rule: "deploy.max-unavailable",
    mutate: (s) => ({ ...s, deployment: s.deployment.replace(/maxUnavailable:\s*0/, "maxUnavailable: 1") }),
  },
  {
    name: "删除 readinessProbe",
    rule: "deploy.probe",
    mutate: (s) => ({
      ...s,
      deployment: s.deployment.replace(/^\s+readinessProbe:[\s\S]*?(?=\n\s+livenessProbe:)/m, ""),
    }),
  },
  {
    name: "镜像 latest",
    rule: "deploy.image",
    mutate: (s) => ({ ...s, deployment: s.deployment.replace(/frontend:0\.0\.0/, "frontend:latest") }),
  },
  {
    name: "HPA min=1",
    rule: "hpa.min",
    mutate: (s) => ({ ...s, hpa: s.hpa.replace(/minReplicas:\s*3/, "minReplicas: 1") }),
  },
  {
    name: "Ingress 去掉 TLS",
    rule: "ingress.tls",
    mutate: (s) => ({
      ...s,
      ingress: s.ingress.replace(/  tls:\n[\s\S]*?secretName: frontend-tls\n/, ""),
    }),
  },
  {
    name: "Service selector 写错",
    rule: "svc.selector",
    mutate: (s) => ({
      ...s,
      // 只改 selector，不改 metadata.labels，模拟「标签改了但选择器没跟上」
      service: s.service.replace(
        /  selector:\n    app\.kubernetes\.io\/name: frontend/,
        "  selector:\n    app.kubernetes.io/name: web",
      ),
    }),
  },
];

for (const m of mutations) {
  const result = auditAll(m.mutate(SOURCES)).issues;
  assert(
    result.some((i) => i.rule === m.rule && i.level === "error"),
    `破坏「${m.name}」未被识别（期望 ${m.rule}）`,
  );
  console.log(`✓ ${m.name} → ${m.rule}`);
}

console.log("\n===== 4. 探针端点与端口一致性 =====");
const frontend = docs.find((d) => d.kind === "Deployment" && d.name === "frontend")!;
assert(/path:\s*\/healthz/.test(frontend.text), "前端探针必须打 /healthz");
assert(/containerPort:\s*8080/.test(frontend.text), "nginx-unprivileged 容器端口应为 8080");
const bff = docs.find((d) => d.kind === "Deployment" && d.name === "bff")!;
assert(/path:\s*\/readyz/.test(bff.text), "BFF 就绪探针应区分 /readyz 与 /healthz");
console.log("✓ frontend:8080/healthz 与 bff:/readyz 语义分离");

console.log("\n✅ K8s 清单：滚动策略 + 三探针 + 资源 + 安全上下文 + 跨资源引用全部通过");
