/** 78-04-license-gate.ts —— 许可证门禁：策略分级 + 传递依赖传染 + 豁免到期 + 退出码 */

type LicenseId =
  | 'MIT'
  | 'ISC'
  | 'BSD-3-Clause'
  | 'Apache-2.0'
  | 'MPL-2.0'
  | 'EPL-2.0'
  | 'LGPL-3.0'
  | 'GPL-3.0'
  | 'AGPL-3.0'
  | 'SSPL-1.0'
  | 'CC-BY-NC-4.0'
  | 'UNKNOWN';

type Tier = 'allow' | 'review' | 'deny';

interface Dep {
  name: string;
  version: string;
  license: LicenseId;
  direct: boolean;
  dev: boolean; // 仅构建期依赖：不必然进入分发物，但仍要登记
}

interface Exemption {
  package: string;
  owner: string;
  expiresAt: string; // YYYY-MM-DD
  reason: string;
}

interface Finding {
  package: string;
  tier: Tier;
  reason: string;
}

interface GateResult {
  exitCode: 0 | 1;
  allowed: string[];
  review: Finding[];
  blocked: Finding[];
  exempted: Finding[];
}

const policy = {
  allow: ['MIT', 'ISC', 'BSD-3-Clause', 'Apache-2.0'] as LicenseId[],
  review: ['MPL-2.0', 'EPL-2.0', 'LGPL-3.0'] as LicenseId[],
  deny: ['GPL-3.0', 'AGPL-3.0', 'SSPL-1.0', 'CC-BY-NC-4.0'] as LicenseId[],
};

const tierOf = (license: LicenseId): Tier => {
  if (policy.allow.includes(license)) return 'allow';
  if (policy.review.includes(license)) return 'review';
  return 'deny'; // 未知、无许可、非商用、强 copyleft 一律 deny
};

function runGate(deps: Dep[], exemptions: Exemption[], today: string): GateResult {
  const result: GateResult = { exitCode: 0, allowed: [], review: [], blocked: [], exempted: [] };

  for (const d of deps) {
    const tier = tierOf(d.license);
    const ex = exemptions.find((e) => e.package === d.name);

    // 1) 豁免只能覆盖 deny/review；到期即回到原档位，避免「一次豁免，永久放行」
    if (ex && tier !== 'allow') {
      if (ex.expiresAt >= today) {
        result.exempted.push({
          package: `${d.name}@${d.version}`,
          tier,
          reason: `豁免至 ${ex.expiresAt}，owner=${ex.owner}：${ex.reason}`,
        });
        continue;
      }
      result.blocked.push({
        package: `${d.name}@${d.version}`,
        tier: 'deny',
        reason: `豁免已于 ${ex.expiresAt} 过期，恢复拦截`,
      });
      continue;
    }

    // 2) 仅构建期依赖：先降级为 review，但仍需确认不会进入分发产物
    if (d.dev && tier !== 'allow') {
      result.review.push({
        package: `${d.name}@${d.version}`,
        tier: 'review',
        reason: `devDependency（${d.license}）：确认未被打进分发物，登记后放行`,
      });
      continue;
    }

    // 3) 传递依赖的 copyleft 会向上传染：不能因为「不是我直接装的」就放过
    if (tier === 'deny') {
      result.blocked.push({
        package: `${d.name}@${d.version}`,
        tier: 'deny',
        reason: d.direct
          ? `${d.license} 不可商用，需替换或购买授权`
          : `${d.license} 经传递依赖传染（非直接依赖）`,
      });
      continue;
    }

    if (tier === 'review') {
      result.review.push({
        package: `${d.name}@${d.version}`,
        tier: 'review',
        reason: `${d.license} 需登记使用方式并走法务评审`,
      });
      continue;
    }

    result.allowed.push(`${d.name}@${d.version}`);
  }

  result.exitCode = result.blocked.length > 0 ? 1 : 0;
  return result;
}

// ---- 用例 1：全宽松许可 ----
const clean = runGate(
  [
    { name: 'vue', version: '3.5.13', license: 'MIT', direct: true, dev: false },
    { name: 'pinia', version: '2.3.0', license: 'MIT', direct: true, dev: false },
    { name: 'axios', version: '1.7.9', license: 'MIT', direct: false, dev: false },
  ],
  [],
  '2026-10-31',
);
console.assert(clean.exitCode === 0 && clean.allowed.length === 3 && clean.blocked.length === 0, '全宽松许可应放行');

// ---- 用例 2：直接 GPL + 传递 AGPL ----
const copyleft = runGate(
  [
    { name: 'direct-gpl', version: '1.0.0', license: 'GPL-3.0', direct: true, dev: false },
    { name: 'deep-agpl', version: '2.0.0', license: 'AGPL-3.0', direct: false, dev: false },
  ],
  [],
  '2026-10-31',
);
console.assert(copyleft.exitCode === 1 && copyleft.blocked.length === 2, 'GPL/AGPL 应阻断');
console.assert(
  copyleft.blocked.some((b) => b.reason.includes('传递依赖')),
  '传递依赖必须单独标注传染来源',
);

// ---- 用例 3：豁免已过期 ----
const expired = runGate(
  [{ name: 'legacy-gpl', version: '1.0.0', license: 'GPL-3.0', direct: true, dev: false }],
  [{ package: 'legacy-gpl', owner: 'frontend-arch', expiresAt: '2026-01-01', reason: '历史遗留，计划替换' }],
  '2026-10-31',
);
console.assert(
  expired.exitCode === 1 && expired.blocked[0].reason.includes('过期'),
  '过期豁免必须恢复拦截',
);

// ---- 用例 4：有效豁免 ----
const valid = runGate(
  [{ name: 'legacy-gpl', version: '1.0.0', license: 'GPL-3.0', direct: true, dev: false }],
  [{ package: 'legacy-gpl', owner: 'frontend-arch', expiresAt: '2027-06-30', reason: '已购商业授权，待下线' }],
  '2026-10-31',
);
console.assert(valid.exitCode === 0 && valid.exempted.length === 1, '有效豁免可放行并留痕');

// ---- 用例 5：仅构建期依赖 ----
const devOnly = runGate(
  [{ name: 'build-tool-gpl', version: '3.0.0', license: 'GPL-3.0', direct: true, dev: true }],
  [],
  '2026-10-31',
);
console.assert(
  devOnly.exitCode === 0 && devOnly.review.length === 1 && devOnly.blocked.length === 0,
  'devDependency 需评审但不必直接阻断',
);

console.log('\n=== 许可证门禁报告 ===');
console.log(`放行 ${clean.allowed.length} 个：${clean.allowed.join(', ')}`);
console.log(`阻断 ${copyleft.blocked.length} 个：${copyleft.blocked.map((b) => `${b.package}（${b.reason}）`).join('；')}`);
console.log(`过期豁免：${expired.blocked[0].package} → ${expired.blocked[0].reason}`);
console.log(`有效豁免：${valid.exempted[0].package} → ${valid.exempted[0].reason}`);
console.log(`devDependency：${devOnly.review[0].package} → ${devOnly.review[0].reason}`);
console.log('\n✅ 策略分级 / 传递依赖 / 豁免到期 / devDependency / 退出码全部通过');
