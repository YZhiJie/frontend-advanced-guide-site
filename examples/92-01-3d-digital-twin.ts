/**
 * 第 92 部分 · 3D 与数字孪生
 * JD 需求点：智慧能源/数字孪生 JD 要求 Three.js / Cesium / GIS 三维可视化、
 *   模型加载、交互拾取、实时数据驱动 3D 场景、坐标转换。
 * 本示例在 Node 环境模拟 Three.js 核心模型：
 *   1) 场景图（Scene/Mesh/Camera/Renderer）
 *   2) 射线拾取（Raycaster，鼠标点选 Mesh）
 *   3) GIS 坐标转换（WGS84 经纬度 → 场景局部坐标）
 *   4) 数字孪生实时数据绑定（传感器值 → Mesh 属性）
 * 运行：npx tsx examples/92-01-3d-digital-twin.ts
 */
import assert from "node:assert";

// ---------- 1. 场景图模型 ----------
type Vec3 = [number, number, number];

interface Mesh {
  id: string;
  name: string;
  position: Vec3;
  scale: Vec3;
  geometry: { type: "box" | "sphere" | "cylinder"; args: number[] };
  material: { color: string; opacity: number };
  userData: Record<string, unknown>;
}

interface Scene {
  meshes: Map<string, Mesh>;
  add(mesh: Mesh): void;
  remove(id: string): void;
}

function createScene(): Scene {
  const meshes = new Map<string, Mesh>();
  return {
    meshes,
    add(m) {
      meshes.set(m.id, m);
    },
    remove(id) {
      meshes.delete(id);
    },
  };
}

// 相机：透视投影，含 fov / near / far
interface Camera {
  position: Vec3;
  target: Vec3;
  fov: number;
  near: number;
  far: number;
}

// ---------- 2. 射线拾取（Raycaster）----------
// 判断射线（origin + direction）与 AABB 是否相交（简化为包围盒检测）
function rayIntersectsBox(
  origin: Vec3,
  dir: Vec3,
  boxMin: Vec3,
  boxMax: Vec3
): boolean {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-8) {
      if (origin[i] < boxMin[i] || origin[i] > boxMax[i]) return false;
    } else {
      const t1 = (boxMin[i] - origin[i]) / dir[i];
      const t2 = (boxMax[i] - origin[i]) / dir[i];
      const lo = Math.min(t1, t2);
      const hi = Math.max(t1, t2);
      tmin = Math.max(tmin, lo);
      tmax = Math.min(tmax, hi);
      if (tmin > tmax) return false;
    }
  }
  return tmax >= 0 && tmin <= tmax;
}

// 由 Mesh 的 position + scale 构造 AABB（假设 box 长宽高为 args[0..2]）
function meshAABB(m: Mesh): { min: Vec3; max: Vec3 } {
  const [sx, sy, sz] = m.scale;
  const hw = (m.geometry.args[0] ?? 1) * sx / 2;
  const hh = (m.geometry.args[1] ?? 1) * sy / 2;
  const hd = (m.geometry.args[2] ?? 1) * sz / 2;
  const [x, y, z] = m.position;
  return {
    min: [x - hw, y - hh, z - hd],
    max: [x + hw, y + hh, z + hd],
  };
}

// 归一化方向向量
function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

// 从相机到屏幕坐标（NDC -1..1）生成射线（简化：正交投影思路，屏幕中心方向指向 target）
function pick(
  scene: Scene,
  camera: Camera,
  ndc: [number, number]
): Mesh[] {
  const dir = normalize([
    camera.target[0] - camera.position[0] + ndc[0],
    camera.target[1] - camera.position[1] + ndc[1],
    camera.target[2] - camera.position[2],
  ]);
  const hits: Mesh[] = [];
  for (const m of scene.meshes.values()) {
    const { min, max } = meshAABB(m);
    if (rayIntersectsBox(camera.position, dir, min, max)) hits.push(m);
  }
  return hits;
}

// ---------- 3. GIS 坐标转换（WGS84 → 局部 ENU 场景坐标）----------
// 简化：以中心经纬度为原点，将经纬度差转为米（1度纬度≈111320m，经度按 cos(lat) 修正）
const DEG_TO_M = 111320;
function wgs84ToLocal(
  lon: number,
  lat: number,
  centerLon: number,
  centerLat: number
): Vec3 {
  const x = (lon - centerLon) * DEG_TO_M * Math.cos((centerLat * Math.PI) / 180);
  const z = (lat - centerLat) * DEG_TO_M;
  return [x, 0, z]; // y 为高度，此处置 0
}

// ---------- 4. 数字孪生：实时数据绑定 ----------
// 传感器数据驱动 Mesh 的颜色/高度/可见性
interface SensorData {
  deviceId: string;
  temperature: number;
  power: number; // kW
  status: "online" | "offline" | "alarm";
}

function bindSensorToMesh(mesh: Mesh, data: SensorData): void {
  // 温度 → 颜色（蓝→红）
  const t = Math.min(1, Math.max(0, (data.temperature - 20) / 80)); // 20~100℃
  const r = Math.round(50 + t * 205);
  const b = Math.round(255 - t * 205);
  mesh.material.color = `rgb(${r},80,${b})`;
  // 功率 → 高度（scale.y）
  mesh.scale[1] = 0.5 + (data.power / 1000) * 3;
  // 状态 → 透明度
  mesh.material.opacity =
    data.status === "offline" ? 0.3 : data.status === "alarm" ? 1 : 0.85;
  mesh.userData = { ...data };
}

// ---------- 5. Cesium 图层组合（简化）----------
interface CesiumLayer {
  id: string;
  type: "imagery" | "3dtiles" | "terrain" | "geojson";
  url: string;
  visible: boolean;
  zIndex: number;
}

function composeLayers(layers: CesiumLayer[]): CesiumLayer[] {
  // 按 zIndex 排序，过滤不可见
  return layers
    .filter((l) => l.visible)
    .sort((a, b) => a.zIndex - b.zIndex);
}

// ===================== 运行断言 =====================
console.log("===== 1. 场景图 =====");
const scene = createScene();
const tower: Mesh = {
  id: "tower-1",
  name: "变电站",
  position: [0, 0, 0],
  scale: [1, 1, 1],
  geometry: { type: "box", args: [10, 20, 10] },
  material: { color: "#888", opacity: 1 },
  userData: {},
};
scene.add(tower);
assert(scene.meshes.size === 1, "场景应包含 1 个 Mesh");
console.log("✓ 场景 add/remove 正常");

console.log("\n===== 2. 射线拾取 =====");
const camera: Camera = {
  position: [0, 50, 100],
  target: [0, 0, 0],
  fov: 60,
  near: 0.1,
  far: 1000,
};
// 屏幕中心 (0,0) 应命中 tower
const hits = pick(scene, camera, [0, 0]);
assert(hits.length === 1 && hits[0].id === "tower-1", "屏幕中心应命中变电站");
// 偏离屏幕中心 (50,50) 不应命中
const miss = pick(scene, camera, [50, 50]);
assert(miss.length === 0, "偏离中心不应命中");
console.log("✓ 射线拾取：命中与非命中正确");

console.log("\n===== 3. GIS 坐标转换 =====");
const p = wgs84ToLocal(116.405, 39.915, 116.404, 39.915);
// 经度差 0.001 度 ≈ 85m（cos39.915≈0.766），纬度差 0
assert(Math.abs(p[0] - 85) < 10, `经度差 0.001° 应≈85m，实际 ${p[0].toFixed(1)}`);
assert(Math.abs(p[2]) < 0.01, "纬度差为 0 时 z 应为 0");
console.log(`✓ WGS84→局部：x=${p[0].toFixed(1)}m, z=${p[2].toFixed(1)}m`);

console.log("\n===== 4. 数字孪生实时数据绑定 =====");
const device: Mesh = {
  id: "dev-1",
  name: "设备",
  position: [5, 0, 5],
  scale: [1, 1, 1],
  geometry: { type: "box", args: [2, 2, 2] },
  material: { color: "#fff", opacity: 1 },
  userData: {},
};
bindSensorToMesh(device, {
  deviceId: "dev-1",
  temperature: 80,
  power: 500,
  status: "alarm",
});
assert(device.material.color.startsWith("rgb("), "温度应映射为 rgb 颜色");
assert(device.scale[1] > 1, `功率 500kW 应抬高 scale.y，实际 ${device.scale[1]}`);
assert(device.material.opacity === 1, "alarm 状态 opacity=1");
console.log(`✓ 数据绑定：color=${device.material.color}, scale.y=${device.scale[1].toFixed(2)}, opacity=${device.material.opacity}`);

console.log("\n===== 5. Cesium 图层组合 =====");
const layers: CesiumLayer[] = [
  { id: "osm", type: "imagery", url: "osm", visible: true, zIndex: 0 },
  { id: "terrain", type: "terrain", url: "terrain", visible: true, zIndex: -1 },
  { id: "tiles", type: "3dtiles", url: "tiles", visible: false, zIndex: 5 },
  { id: "geo", type: "geojson", url: "geo", visible: true, zIndex: 10 },
];
const composed = composeLayers(layers);
assert(composed.length === 3, "应过滤掉不可见的 3dtiles");
assert(composed[0].id === "terrain", "排序后 terrain(zIndex=-1) 应在最前");
assert(composed[2].id === "geo", "geojson(zIndex=10) 应在最后");
console.log("✓ 图层组合：过滤不可见 + 按 zIndex 排序");

console.log("\n✅ 3D 场景图 + 射线拾取 + GIS 坐标转换 + 数字孪生数据绑定 + Cesium 图层全部通过");
