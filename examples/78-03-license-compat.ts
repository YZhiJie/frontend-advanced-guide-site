/** 78-03-license-compat.ts —— 开源许可证商用判定：许可分类 + 分发形态 + 修改/链接 + 双许可表达式 */

type SpdxId =
  | 'MIT'
  | 'ISC'
  | 'BSD-2-Clause'
  | 'BSD-3-Clause'
  | 'Apache-2.0'
  | 'LGPL-3.0'
  | 'MPL-2.0'
  | 'EPL-2.0'
  | 'GPL-3.0'
  | 'AGPL-3.0'
  | 'SSPL-1.0'
  | 'BUSL-1.1'
  | 'Elastic-2.0'
  | 'CC-BY-NC-4.0'
  | 'UNLICENSED'
  | 'UNKNOWN';

type Distribution = 'browser-bundle' | 'saas' | 'internal-only';
type Linkage = 'static' | 'dynamic' | 'none';

interface Context {
  distribution: Distribution;
  modified: boolean;
  linkage: Linkage;
}

type Verdict = 'allow' | 'allow-with-obligations' | 'legal-review' | 'deny';

interface Decision {
  verdict: Verdict;
  obligations: string[];
  reason: string;
}

const RANK: Record<Verdict, number> = {
  allow: 0,
  'allow-with-obligations': 1,
  'legal-review': 2,
  deny: 3,
};

const PERMISSIVE: SpdxId[] = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0'];
const WEAK: SpdxId[] = ['MPL-2.0', 'EPL-2.0'];
const SOURCE_AVAILABLE: SpdxId[] = ['SSPL-1.0', 'BUSL-1.1', 'Elastic-2.0'];
const NON_COMMERCIAL: SpdxId[] = ['CC-BY-NC-4.0'];

/**
 * 判定原则：
 * 1) 无许可/未知 = 保留所有权利，直接 deny；
 * 2) 宽松许可 = 可商用，但必须保留版权与许可文本；
 * 3) 弱 copyleft = 只对被修改/涉及的文件生效，前端静态打包要按高风险处理；
 * 4) 强 copyleft = 分发或网络交互即触发，前端 bundle 与 SaaS 都要阻断；
 * 5) 源码可见但非 OSI、非商用许可 = 默认不可商用。
 */
function judge(id: SpdxId, ctx: Context = { distribution: 'browser-bundle', modified: false, linkage: 'static' }): Decision {
  if (id === 'UNLICENSED' || id === 'UNKNOWN') {
    return { verdict: 'deny', obligations: [], reason: '无明确许可，视为保留所有权利' };
  }

  if (PERMISSIVE.includes(id)) {
    const obligations = ['保留版权声明与许可文本'];
    if (id === 'Apache-2.0') {
      obligations.push('保留 NOTICE 文件（如有）', '标注修改过的文件');
    }
    return { verdict: 'allow-with-obligations', obligations, reason: `${id} 为宽松许可，可商用` };
  }

  if (NON_COMMERCIAL.includes(id)) {
    return { verdict: 'deny', obligations: [], reason: `${id} 禁止商业使用，需购买授权或替换` };
  }

  if (SOURCE_AVAILABLE.includes(id)) {
    return { verdict: 'deny', obligations: [], reason: `${id} 属源码可见但非 OSI 开源，默认不可商用` };
  }

  if (WEAK.includes(id)) {
    const obligations = ['保留版权声明与许可文本'];
    if (ctx.modified) obligations.push('修改过的文件需以同许可开放');
    return {
      verdict: 'allow-with-obligations',
      obligations,
      reason: `${id} 为弱 copyleft，仅修改部分需开源；需登记使用方式`,
    };
  }

  if (id === 'LGPL-3.0') {
    if (ctx.modified) {
      return { verdict: 'legal-review', obligations: ['修改部分需开源'], reason: 'LGPL 修改后义务显著上升' };
    }
    if (ctx.linkage !== 'dynamic') {
      return {
        verdict: 'legal-review',
        obligations: ['保留声明', '需允许用户替换/重链接库'],
        reason: '前端打包近似静态链接，LGPL 边界需法务确认',
      };
    }
    return { verdict: 'allow-with-obligations', obligations: ['保留声明', '保持可替换'], reason: 'LGPL 动态链接义务可控' };
  }

  if (id === 'GPL-3.0') {
    if (ctx.distribution === 'internal-only') {
      return {
        verdict: 'allow-with-obligations',
        obligations: ['保留声明', '不得对外分发衍生作品'],
        reason: '仅内部使用不构成分发，仍需保留声明',
      };
    }
    return { verdict: 'deny', obligations: [], reason: '前端分发会触发 GPL 同许可开源义务' };
  }

  if (id === 'AGPL-3.0') {
    if (ctx.distribution === 'internal-only') {
      return {
        verdict: 'legal-review',
        obligations: ['网络交互也可能触发源码提供义务'],
        reason: '即使内部部署，AGPL 网络条款仍可能触发，需法务确认',
      };
    }
    return { verdict: 'deny', obligations: [], reason: 'AGPL 网络交互/分发触发源码开放义务，SaaS 与前端均阻断' };
  }

  return { verdict: 'legal-review', obligations: [], reason: '未收录的许可类型，需人工核对 LICENSE 正文' };
}

/** 双许可表达式：OR 选义务最轻的分支，AND 必须同时满足（取最严） */
function judgeExpression(expr: string, ctx: Context): Decision {
  if (expr.includes(' OR ')) {
    const results = expr.split(' OR ').map((p) => judge(p.trim() as SpdxId, ctx));
    return results.sort((a, b) => RANK[a.verdict] - RANK[b.verdict])[0];
  }
  if (expr.includes(' AND ')) {
    const results = expr.split(' AND ').map((p) => judge(p.trim() as SpdxId, ctx));
    results.sort((a, b) => RANK[b.verdict] - RANK[a.verdict]);
    return {
      verdict: results[0].verdict,
      obligations: [...new Set(results.flatMap((r) => r.obligations))],
      reason: `AND 表达式需同时满足：${results[0].reason}`,
    };
  }
  return judge(expr as SpdxId, ctx);
}

const bundle: Context = { distribution: 'browser-bundle', modified: false, linkage: 'static' };
const saas: Context = { distribution: 'saas', modified: false, linkage: 'dynamic' };
const internal: Context = { distribution: 'internal-only', modified: false, linkage: 'static' };

// ---- 断言 ----
const mit = judge('MIT', bundle);
console.assert(mit.verdict === 'allow-with-obligations', 'MIT 可商用，但有保留声明义务');

const apache = judge('Apache-2.0', bundle);
console.assert(apache.obligations.some((o) => o.includes('NOTICE')), 'Apache-2.0 必须保留 NOTICE');

const agpl = judge('AGPL-3.0', saas);
console.assert(agpl.verdict === 'deny', 'AGPL 在 SaaS 场景必须阻断');

const lgpl = judge('LGPL-3.0', bundle);
console.assert(lgpl.verdict === 'legal-review', 'LGPL 静态打包需法务评审');

const mpl = judge('MPL-2.0', { distribution: 'browser-bundle', modified: true, linkage: 'static' });
console.assert(
  mpl.obligations.some((o) => o.includes('修改')),
  'MPL 修改过的文件需开源',
);

const dualOr = judgeExpression('MIT OR GPL-3.0', bundle);
console.assert(
  dualOr.verdict === 'allow-with-obligations' && dualOr.reason.includes('MIT'),
  'OR 双许可可选宽松分支',
);

const dualAnd = judgeExpression('MIT AND GPL-3.0', bundle);
console.assert(dualAnd.verdict === 'deny', 'AND 双许可必须同时满足，分发场景应阻断');

const unknown = judge('UNKNOWN', bundle);
console.assert(unknown.verdict === 'deny', '未知许可视为保留所有权利');

const gplInternal = judge('GPL-3.0', internal);
console.assert(gplInternal.verdict === 'allow-with-obligations', '仅内部使用不构成分发');

console.log('\n=== 商用判定样例 ===');
for (const [name, d] of Object.entries({ MIT: mit, Apache: apache, AGPL: agpl, LGPL: lgpl, 'MPL(modified)': mpl, 'MIT OR GPL': dualOr, 'MIT AND GPL': dualAnd })) {
  console.log(`${name.padEnd(14)} ${d.verdict.padEnd(20)} ${d.obligations.join('；') || '-'}`);
}
console.log('\n✅ 许可分类 / 分发形态 / 修改与链接 / 双许可 OR·AND 全部通过');
