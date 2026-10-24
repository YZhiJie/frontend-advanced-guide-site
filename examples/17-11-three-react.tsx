// 文件: examples/17-11-three-react.tsx —— [React 19] Three.js 集成:useRef + useEffect
// @ts-nocheck —— 示意代码:实际运行需 npm i three react react-dom(本项目无依赖,故跳过类型检查)
// import * as THREE from 'three';

// React 侧:useRef 管 DOM,useEffect 初始化/清理
// (以下为示意代码,实际需 npm i three)
declare const THREE: typeof import("three");
import * as React from "react";
const { useEffect } = React;

function useThreeScene(containerRef: React.RefObject<HTMLElement>) {
  useEffect(() => {
    if (!containerRef.current) return;

    // 1. 场景、相机、渲染器(命令式初始化)
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    containerRef.current.appendChild(renderer.domElement);
    camera.position.z = 5;

    // 2. 几何体
    const geo = new THREE.BoxGeometry();
    const mat = new THREE.MeshBasicMaterial({ color: 0x1890ff });
    const cube = new THREE.Mesh(geo, mat);
    scene.add(cube);

    // 3. 动画循环
    let rafId: number;
    const animate = () => {
      cube.rotation.x += 0.01;
      cube.rotation.y += 0.01;
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    animate();

    // 4. resize 监听
    const onResize = () => {
      const w = containerRef.current!.clientWidth;
      const h = containerRef.current!.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    onResize();
    window.addEventListener("resize", onResize);

    // 5. ✅ 清理(关键!漏了会泄漏 WebGL context,多次切换后 WebGL context 数超上限)
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      geo.dispose();
      mat.dispose();
      containerRef.current?.removeChild(renderer.domElement);
    };
  }, []);
}

export {};
