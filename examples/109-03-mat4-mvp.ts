// 文件: examples/109-03-mat4-mvp.ts
// 最小 4x4 矩阵库：MVP 管线（Model-View-Projection）手推一遍
// 目标：看懂 gl_Position = P × V × M × pos 每一步在干什么，列主序与 WebGL 一致

import assert from "node:assert";

type Mat4 = Float32Array; // 长度 16，列主序（WebGL/OpenGL 约定）
type Vec3 = [number, number, number];

function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** 矩阵乘：out = a × b（先应用 b，再应用 a） */
function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function translate(x: number, y: number, z: number): Mat4 {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

/** 绕 Y 轴旋转（右手系，弧度） */
function rotateY(rad: number): Mat4 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const m = identity();
  m[0] = c;
  m[2] = -s;
  m[8] = s;
  m[10] = c;
  return m;
}

/** 透视投影：fovY 弧度，aspect 宽高比 */
function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/** 视图矩阵：eye 看向 center，up 为上方向 */
function lookAt(eye: Vec3, center: Vec3, up: Vec3): Mat4 {
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v: Vec3): Vec3 => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const zc = norm(sub(eye, center)); // 相机朝 -z 看
  const xc = norm(cross(up, zc));
  const yc = cross(zc, xc);

  const m = identity();
  m[0] = xc[0];
  m[1] = yc[0];
  m[2] = zc[0];
  m[4] = xc[1];
  m[5] = yc[1];
  m[6] = zc[1];
  m[8] = xc[2];
  m[9] = yc[2];
  m[10] = zc[2];
  m[12] = -dot(xc, eye);
  m[13] = -dot(yc, eye);
  m[14] = -dot(zc, eye);
  return m;
}

/** 矩阵作用于点（w=1），返回 [x,y,z,w]；透视除法由调用方做 */
function transformPoint(m: Mat4, p: Vec3): [number, number, number, number] {
  const [x, y, z] = p;
  const out = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++) {
    out[row] = m[row] * x + m[4 + row] * y + m[8 + row] * z + m[12 + row] * 1;
  }
  return out as [number, number, number, number];
}

const nearly = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) < eps;

function runAssertions() {
  // ---------- 测试 1：单位矩阵性质 M × I = M ----------
  const t = translate(3, 4, 5);
  const ti = multiply(t, identity());
  assert.deepEqual([...ti], [...t]);
  console.log("[1/4] 单位矩阵性质 OK");

  // ---------- 测试 2：平移 + 旋转复合（先转后移） ----------
  const model = multiply(translate(10, 0, 0), rotateY(Math.PI / 2));
  const [x, , z] = transformPoint(model, [1, 0, 0]);
  // (1,0,0) 绕 Y 转 90° → (0,0,-1)，再平移 (10,0,0) → (10,0,-1)
  assert.ok(nearly(x, 10) && nearly(z, -1), `得到 (${x}, ${z})`);
  console.log("[2/4] 复合变换 OK:", `(${x.toFixed(3)}, ${z.toFixed(3)})`);

  // ---------- 测试 3：lookAt——eye(0,0,5) 看原点，原点在视图空间应为 (0,0,-5) ----------
  const view = lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
  const [vx, vy, vz] = transformPoint(view, [0, 0, 0]);
  assert.ok(nearly(vx, 0) && nearly(vy, 0) && nearly(vz, -5), `视图坐标 (${vx}, ${vy}, ${vz})`);
  console.log("[3/4] lookAt OK:", `(${vx.toFixed(2)}, ${vy.toFixed(2)}, ${vz.toFixed(2)})`);

  // ---------- 测试 4：完整 MVP——原点经 V 和 P 后落在 NDC 中心 ----------
  const proj = perspective(Math.PI / 3, 16 / 9, 0.1, 100);
  const pv = multiply(proj, view);
  const [cx, cy, cz, cw] = transformPoint(pv, [0, 0, 0]);
  const ndcX = cx / cw;
  const ndcY = cy / cw;
  const ndcZ = cz / cw;
  assert.ok(nearly(ndcX, 0) && nearly(ndcY, 0), "视线中心应映射到 NDC (0,0)");
  assert.ok(ndcZ > -1 && ndcZ < 1, `ndcZ 应在 (-1,1)，实际 ${ndcZ}`);
  assert.ok(cw > 0, "相机前方的点 w 应为正（否则被裁剪）");
  console.log("[4/4] MVP 管线 OK, NDC:", `(${ndcX.toFixed(3)}, ${ndcY.toFixed(3)}, ${ndcZ.toFixed(3)})`);

  console.log("\n✅ 109-03 最小矩阵库 MVP 全部断言通过");
}

runAssertions();
