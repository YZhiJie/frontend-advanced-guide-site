// flex-layout.test.ts — 10+ 用例

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { layoutFlex, getContainerProps, getItemProps } from '../src/flex-layout.js';
import type { Box } from '../src/box-model.js';

function makeStyle(props: Record<string, string>) {
  const m = new Map<string, { type: 'declaration'; property: string; value: string; important: boolean }>();
  for (const [k, v] of Object.entries(props)) {
    m.set(k, { type: 'declaration', property: k, value: v, important: false });
  }
  return { properties: m as unknown as Map<string, import('../src/css-parser.js').Declaration> };
}

function makeBox(
  tag: string,
  w: number,
  h: number,
  styleProps: Record<string, string> = {},
): Box {
  return {
    node: { tag, children: [] },
    width: w, height: h,
    paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
    borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
    marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
    boxSizing: 'content-box',
    x: 0, y: 0,
    borderWidth: w, borderHeight: h,
    marginBoxWidth: w, marginBoxHeight: h,
    children: [],
    style: makeStyle(styleProps),
  };
}

function makeFlexContainer(mainSize: number, crossSize: number, styleProps: Record<string, string>, children: Box[]): Box {
  const container = makeBox('div', mainSize, crossSize, { display: 'flex', ...styleProps });
  container.children = children;
  return container;
}

describe('getContainerProps', () => {
  it('默认值', () => {
    const c = makeFlexContainer(1000, 600, {}, []);
    const props = getContainerProps(c);
    assert.equal(props.direction, 'row');
    assert.equal(props.wrap, 'nowrap');
    assert.equal(props.justifyContent, 'flex-start');
    assert.equal(props.alignItems, 'stretch');
  });

  it('自定义 direction 和 wrap', () => {
    const c = makeFlexContainer(1000, 600, { 'flex-direction': 'column', 'flex-wrap': 'wrap' }, []);
    const props = getContainerProps(c);
    assert.equal(props.direction, 'column');
    assert.equal(props.wrap, 'wrap');
  });
});

describe('item props', () => {
  it('默认 grow=0 shrink=1 basis=auto', () => {
    const item = makeBox('div', 100, 50);
    const props = getItemProps(item);
    assert.equal(props.flexGrow, 0);
    assert.equal(props.flexShrink, 1);
    assert.equal(props.flexBasis, 'auto');
  });

  it('flex 简写解析', () => {
    const item = makeBox('div', 100, 50, { flex: '1 1 200px' });
    const props = getItemProps(item);
    assert.equal(props.flexGrow, 1);
    assert.equal(props.flexShrink, 1);
    assert.equal(props.flexBasis, 200);
  });

  it('flex: none', () => {
    const item = makeBox('div', 100, 50, { flex: 'none' });
    const props = getItemProps(item);
    assert.equal(props.flexGrow, 0);
    assert.equal(props.flexShrink, 0);
    assert.equal(props.flexBasis, 'auto');
  });
});

describe('layoutFlex: row 基础', () => {
  it('默认 flex-start 左对齐', () => {
    const children = [
      makeBox('div', 100, 50),
      makeBox('div', 100, 50),
    ];
    const container = makeFlexContainer(1000, 600, {}, children);
    layoutFlex(container);
    assert.equal(children[0].x, 0);
    assert.equal(children[1].x, 100);
  });

  it('justify-content: center', () => {
    const children = [
      makeBox('div', 100, 50),
      makeBox('div', 100, 50),
    ];
    const container = makeFlexContainer(1000, 600, { 'justify-content': 'center' }, children);
    layoutFlex(container);
    // 总宽 200，剩余 800，两边各 400
    assert.equal(children[0].x, 400);
    assert.equal(children[1].x, 500);
  });

  it('justify-content: space-between', () => {
    const children = [
      makeBox('div', 100, 50),
      makeBox('div', 100, 50),
      makeBox('div', 100, 50),
    ];
    const container = makeFlexContainer(1000, 600, { 'justify-content': 'space-between' }, children);
    layoutFlex(container);
    // 间隔 = (1000 - 300) / 2 = 350
    assert.equal(children[0].x, 0);
    assert.equal(children[1].x, 450); // 100 + 350
    assert.equal(children[2].x, 900); // 450 + 100 + 350
  });
});

describe('layoutFlex: flex-grow', () => {
  it('grow=1 均分剩余空间', () => {
    const children = [
      makeBox('div', 100, 50, { 'flex-grow': '1' }),
      makeBox('div', 100, 50, { 'flex-grow': '1' }),
    ];
    const container = makeFlexContainer(500, 600, {}, children);
    layoutFlex(container);
    // 剩余 = 500 - 200 = 300，每人 +150，最终宽 250
    assert.equal(children[0].width, 250);
    assert.equal(children[1].width, 250);
  });

  it('grow 比例分配', () => {
    const children = [
      makeBox('div', 100, 50, { 'flex-grow': '2' }),
      makeBox('div', 100, 50, { 'flex-grow': '1' }),
    ];
    const container = makeFlexContainer(400, 600, {}, children);
    layoutFlex(container);
    // 剩余 = 400 - 200 = 200, 比例 2:1 → 第一个 + 133.33, 第二个 + 66.67
    assert.ok(Math.abs(children[0].width - 233.33) < 1);
    assert.ok(Math.abs(children[1].width - 166.67) < 1);
  });
});

describe('layoutFlex: flex-shrink', () => {
  it('空间不足时 shrink', () => {
    const children = [
      makeBox('div', 200, 50, { 'flex-shrink': '1' }),
      makeBox('div', 200, 50, { 'flex-shrink': '1' }),
    ];
    const container = makeFlexContainer(300, 600, {}, children);
    layoutFlex(container);
    // 总 basis 400，空间 300 → deficit 100，均分 → 各 -50 → 最终 150
    assert.equal(children[0].width, 150);
    assert.equal(children[1].width, 150);
  });
});

describe('layoutFlex: flex-basis', () => {
  it('basis 覆盖 width', () => {
    const children = [
      makeBox('div', 100, 50, { 'flex-basis': '200px' }),
    ];
    const container = makeFlexContainer(500, 600, {}, children);
    layoutFlex(container);
    assert.equal(children[0].width, 200);
  });
});

describe('layoutFlex: align-items', () => {
  it('align-items: center (cross axis)', () => {
    const children = [
      makeBox('div', 100, 50),
    ];
    const container = makeFlexContainer(500, 200, { 'align-items': 'center' }, children);
    layoutFlex(container);
    // cross = 200, item height = 50, top offset = (200 - 50) / 2 = 75
    assert.equal(children[0].y, 75);
  });

  it('align-self 覆盖 container', () => {
    const children = [
      makeBox('div', 100, 50, { 'align-self': 'flex-end' }),
    ];
    const container = makeFlexContainer(500, 200, { 'align-items': 'flex-start' }, children);
    layoutFlex(container);
    assert.equal(children[0].y, 150); // cross=200, item=50, end aligned: 200-50
  });

  it('stretch 默认拉满交叉轴', () => {
    const children = [
      makeBox('div', 100, 0),
    ];
    const container = makeFlexContainer(500, 200, {}, children);
    layoutFlex(container);
    // item 高度 0 时 stretch 到 cross=200
    assert.equal(children[0].height, 200);
  });
});

describe('layoutFlex: column', () => {
  it('column 方向主轴变为垂直', () => {
    const children = [
      makeBox('div', 100, 50, { 'flex-grow': '1' }),
      makeBox('div', 100, 50, { 'flex-grow': '1' }),
    ];
    const container = makeFlexContainer(400, 500, { 'flex-direction': 'column' }, children);
    layoutFlex(container);
    // 剩余 = 500 - 100 = 400, 各 +200, 高 = 250
    assert.equal(children[0].height, 250);
    assert.equal(children[1].height, 250);
  });
});

describe('layoutFlex: order', () => {
  it('order 重排 items', () => {
    const children = [
      makeBox('div', 100, 50, { order: '2' }),
      makeBox('div', 100, 50, { order: '1' }),
    ];
    const container = makeFlexContainer(500, 200, {}, children);
    layoutFlex(container);
    // 原来 child[0] order=2, child[1] order=1 → child[1] 先排
    assert.equal(children[1].x, 0);
    assert.equal(children[0].x, 100);
  });
});
