/** 78-02-lib-fit-evaluator.ts —— npm 选库评估器：六维加权 + 六条硬门槛 + 四级决策 */

type LicenseClass =
  | 'permissive'
  | 'weak-copyleft'
  | 'strong-copyleft'
  | 'source-available'
  | 'non-commercial'
  | 'unknown';

interface Candidate {
  name: string;
  fit: number; // 需求契合度 1~5
  maintenance: number; // 维护与治理 1~5
  size: number; // 体积与性能 1~5
  dx: number; // 类型与 DX 1~5
  ecosystem: number; // 生态与文档 1~5
  exit: number; // 可替换性 1~5（越高越好替换）
  gzipKb: number;
  budgetKb: number;
  license: LicenseClass;
  nativeAlternative: boolean;
  duplicateOfExisting: boolean;
  deprecated: boolean;
  hasInstallScript: boolean;
}

type Decision = 'adopt' | 'pilot' | 'review' | 'reject' | 'block';

interface Result {
  name: string;
  score: number;
  decision: Decision;
  reasons: string[];
}

const criteria = [
  { key: 'fit', weight: 0.30 },
  { key: 'maintenance', weight: 0.20 },
  { key: 'size', weight: 0.15 },
  { key: 'dx', weight: 0.15 },
  { key: 'ecosystem', weight: 0.10 },
  { key: 'exit', weight: 0.10 },
] as const;

const scoreOf = (c: Candidate) =>
  criteria.reduce((sum, x) => sum + x.weight * c[x.key], 0);

function evaluate(c: Candidate): Result {
  const reasons: string[] = [];
  const score = scoreOf(c);

  // 硬门槛先于分数：任何一条命中，都不允许「靠高分救回来」
  if (c.nativeAlternative) {
    return { name: c.name, score, decision: 'reject', reasons: ['原生能力已覆盖，引入只增加长期负担'] };
  }
  if (c.duplicateOfExisting) {
    return { name: c.name, score, decision: 'reject', reasons: ['与已有依赖能力重复，推高包体与认知成本'] };
  }
  if (c.deprecated) {
    return { name: c.name, score, decision: 'reject', reasons: ['包已废弃，未来安全修复无人承接'] };
  }
  if (c.license === 'strong-copyleft' || c.license === 'source-available' || c.license === 'non-commercial' || c.license === 'unknown') {
    return { name: c.name, score, decision: 'block', reasons: [`许可 ${c.license} 不可直接商用，转 78.4 判定`] };
  }
  if (c.gzipKb > c.budgetKb) {
    return {
      name: c.name,
      score,
      decision: 'reject',
      reasons: [`打包体积 ${c.gzipKb}KB 超过页面预算 ${c.budgetKb}KB`],
    };
  }

  let decision: Decision = score >= 4.2 ? 'adopt' : score >= 3.2 ? 'pilot' : 'review';
  if (c.hasInstallScript) {
    decision = 'review';
    reasons.push('含 install/postinstall 脚本，安装即执行，必须人工复核');
  }
  if (c.license === 'weak-copyleft') {
    if (decision === 'adopt') decision = 'pilot';
    reasons.push('弱 copyleft：需确认是否修改、是否静态打包，再走法务');
  }
  if (score < 3.2) reasons.push('综合分低于 3.2，仅建议评审，不建议直接引入');
  return { name: c.name, score, decision, reasons };
}

// ---- 断言 ----
const native = evaluate({
  name: 'date-native',
  fit: 5, maintenance: 5, size: 5, dx: 5, ecosystem: 5, exit: 5,
  gzipKb: 2, budgetKb: 90,
  license: 'permissive', nativeAlternative: true, duplicateOfExisting: false,
  deprecated: false, hasInstallScript: false,
});
console.assert(native.decision === 'reject' && native.reasons[0].includes('原生'), '原生可覆盖时一票否决');

const table = evaluate({
  name: 'table-lite',
  fit: 5, maintenance: 4, size: 5, dx: 4, ecosystem: 4, exit: 4,
  gzipKb: 24, budgetKb: 90,
  license: 'permissive', nativeAlternative: false, duplicateOfExisting: false,
  deprecated: false, hasInstallScript: false,
});
console.assert(Math.abs(table.score - 4.45) < 1e-9 && table.decision === 'adopt', '高分且无硬门槛直接采用');

const heavy = evaluate({
  name: 'chart-heavy',
  fit: 5, maintenance: 5, size: 1, dx: 5, ecosystem: 5, exit: 4,
  gzipKb: 180, budgetKb: 90,
  license: 'permissive', nativeAlternative: false, duplicateOfExisting: false,
  deprecated: false, hasInstallScript: false,
});
console.assert(heavy.decision === 'reject' && heavy.reasons[0].includes('预算'), '体积超预算直接淘汰');

const agplChart = evaluate({
  name: 'graph-gpl',
  fit: 5, maintenance: 5, size: 4, dx: 5, ecosystem: 5, exit: 3,
  gzipKb: 40, budgetKb: 90,
  license: 'strong-copyleft', nativeAlternative: false, duplicateOfExisting: false,
  deprecated: false, hasInstallScript: false,
});
console.assert(agplChart.decision === 'block', '强 copyleft 直接阻断，分数再高也不能放行');

const midForm = evaluate({
  name: 'form-mid',
  fit: 4, maintenance: 3, size: 4, dx: 4, ecosystem: 3, exit: 3,
  gzipKb: 30, budgetKb: 90,
  license: 'permissive', nativeAlternative: false, duplicateOfExisting: false,
  deprecated: false, hasInstallScript: false,
});
console.assert(midForm.decision === 'pilot', '3.2~4.2 分先试点，不直接全量引入');

const installScript = evaluate({
  name: 'util-script',
  fit: 5, maintenance: 4, size: 4, dx: 5, ecosystem: 4, exit: 4,
  gzipKb: 12, budgetKb: 90,
  license: 'permissive', nativeAlternative: false, duplicateOfExisting: false,
  deprecated: false, hasInstallScript: true,
});
console.assert(installScript.decision === 'review', '安装脚本硬门槛强制人工复核');

console.log('\n=== 选库评估 ===');
for (const r of [native, table, heavy, agplChart, midForm, installScript]) {
  console.log(`${r.name.padEnd(14)} ${r.score.toFixed(2)}  ${r.decision.padEnd(6)} ${r.reasons.join('；')}`);
}
console.log('\n✅ 六维评分 / 六条硬门槛 / 四级决策全部通过');
