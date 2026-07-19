// Converts the live scene into a GLB-friendly clone:
//  - InstancedMesh -> single merged mesh (GLB viewers all understand it)
//  - the animated ShaderMaterial screen -> emissive standard material
import * as THREE from 'three';
import { GLTFExporter } from '../vendor/GLTFExporter.js';

export function buildExportScene(theater) {
  const out = new THREE.Group();
  out.name = 'IMAX_Theater';

  for (const child of theater.group.children) {
    if (child.isInstancedMesh) {
      // one node per instance, all sharing a single mesh — the exporter
      // dedupes shared geometry, keeping the file small
      const holder = new THREE.Group();
      holder.name = (child.name || 'instances') + '_group';
      const m = new THREE.Matrix4();
      for (let i = 0; i < child.count; i++) {
        child.getMatrixAt(i, m);
        const mesh = new THREE.Mesh(child.geometry, child.material);
        m.decompose(mesh.position, mesh.quaternion, mesh.scale);
        holder.add(mesh);
      }
      out.add(holder);
    } else if (child.isMesh && child.material && child.material.isShaderMaterial) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x05070d, emissive: 0x24407c, emissiveIntensity: 1.4,
        roughness: 0.9, metalness: 0,
      });
      const mesh = new THREE.Mesh(child.geometry, mat);
      mesh.position.copy(child.position);
      mesh.quaternion.copy(child.quaternion);
      mesh.name = 'screen';
      out.add(mesh);
    } else if (child.isMesh || child.isLight) {
      const clone = child.clone();
      out.add(clone);
    }
  }
  return out;
}

export function exportGLB(theater) {
  return new Promise((resolve, reject) => {
    const scene = buildExportScene(theater);
    const exporter = new GLTFExporter();
    exporter.parse(
      scene,
      (result) => resolve(result),
      (err) => reject(err),
      { binary: true, maxTextureSize: 2048 },
    );
  });
}
