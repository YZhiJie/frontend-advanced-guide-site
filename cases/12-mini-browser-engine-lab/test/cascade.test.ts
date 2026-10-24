// cascade.test.ts — 8+ 用例

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseStylesheet } from '../src/css-parser.js';
import { specificityForSelector, compareSpecificity, cascade, collectCascadable, resolveStyle } from '../src/cascade.js';
import { buildDomTree } from '../src/selector.js';
import type { DomNode } from '../src/selector.js';

describe('specificity', () => {
  it('计算四元组', () => {
    // inline, id, class, tag
    assert.deepEqual(specificityForSelector('div'), [0, 0, 0, 1]);
    assert.deepEqual(specificityForSelector('.a'), [0, 0, 1, 0]);
    assert.deepEqual(specificityForSelector('#x'), [0, 1, 0, 0]);
    assert.deepEqual(specificityForSelector('div.a'), [0, 0, 1, 1]);
    assert.deepEqual(specificityForSelector('#x.a'), [0, 1, 1, 0]);
    assert.deepEqual(specificityForSelector('div#x.a:hover'), [0, 1, 2, 1]);
  });

  it('比较 specificity', () => {
    assert.ok(compareSpecificity([0, 1, 0, 0], [0, 0, 100, 100]) > 0);
    assert.ok(compareSpecificity([0, 0, 1, 0], [0, 0, 0, 1]) > 0);
    assert.ok(compareSpecificity([0, 0, 0, 1], [0, 0, 0, 1]) === 0);
    assert.ok(compareSpecificity([0, 0, 0, 1], [0, 0, 0, 2]) < 0);
  });
});

describe('cascade: 基本层叠', () => {
  it('高 specificity 覆盖低', () => {
    const html = `<style>
      div { color: red; }
      div#main { color: blue; }
    </style>`;
    // 手动构建 CSS AST
    const ss = parseStylesheet('div { color: red; } div#main { color: blue; }');
    const node: DomNode = { tag: 'div', id: 'main', children: [] };
    buildDomTree([node]);

    const style = resolveStyle(node, ss.children);
    assert.equal(style.properties.get('color')?.value, 'blue');
  });

  it('同 specificity：后者覆盖前者', () => {
    const ss = parseStylesheet('.a { color: red; } .a { color: green; }');
    const node: DomNode = { tag: 'div', className: 'a', children: [] };
    buildDomTree([node]);

    const style = resolveStyle(node, ss.children);
    assert.equal(style.properties.get('color')?.value, 'green');
  });
});

describe('cascade: !important', () => {
  it('!important 覆盖普通声明（即使 specificity 低）', () => {
    const ss = parseStylesheet('#x { color: blue; } div { color: red !important; }');
    const node: DomNode = { tag: 'div', id: 'x', children: [] };
    buildDomTree([node]);

    const style = resolveStyle(node, ss.children);
    assert.equal(style.properties.get('color')?.value, 'red');
  });

  it('!important 之间：高 specificity 胜', () => {
    const ss = parseStylesheet('div { color: red !important; } #x { color: blue !important; }');
    const node: DomNode = { tag: 'div', id: 'x', children: [] };
    buildDomTree([node]);

    const style = resolveStyle(node, ss.children);
    assert.equal(style.properties.get('color')?.value, 'blue');
  });

  it('inline !important 最高优先级', () => {
    const ss = parseStylesheet('#x { color: blue !important; }');
    const node: DomNode = { tag: 'div', id: 'x', children: [] };
    buildDomTree([node]);

    const style = resolveStyle(node, ss.children, [
      { type: 'declaration', property: 'color', value: 'orange', important: true },
    ]);
    assert.equal(style.properties.get('color')?.value, 'orange');
  });
});

describe('cascade: 多属性合并', () => {
  it('不同属性共存', () => {
    const ss = parseStylesheet('div { color: red; font-size: 14px; } .a { background: white; }');
    const node: DomNode = { tag: 'div', className: 'a', children: [] };
    buildDomTree([node]);

    const style = resolveStyle(node, ss.children);
    assert.equal(style.properties.get('color')?.value, 'red');
    assert.equal(style.properties.get('font-size')?.value, '14px');
    assert.equal(style.properties.get('background')?.value, 'white');
  });
});

describe('collectCascadable', () => {
  it('正确匹配并收集 declarations', () => {
    const ss = parseStylesheet('div { color: red; } .a { color: blue; } span { color: green; }');
    const node: DomNode = { tag: 'div', className: 'a', children: [] };
    buildDomTree([node]);

    const decls = collectCascadable(node, ss.children);
    const colorDecls = decls.filter(d => d.declaration.property === 'color');
    assert.equal(colorDecls.length, 2);
  });

  it('selector 优先级正确', () => {
    const ss = parseStylesheet('div.a { color: blue; } div { color: red; }');
    const node: DomNode = { tag: 'div', className: 'a', children: [] };
    buildDomTree([node]);

    const style = resolveStyle(node, ss.children);
    assert.equal(style.properties.get('color')?.value, 'blue');
  });
});
