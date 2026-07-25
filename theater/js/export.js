// Bakes the live scene into a portable .glb.
//
// Two substitutions are needed: instanced seating becomes one node per seat
// sharing a single mesh (glTF has no instancing, but the exporter de-duplicates
// shared geometry so the file stays small), and the live projection surface
// becomes a plain emissive panel.
import * as THREE from 'three';
import { GLTFExporter } from '../vendor/GLTFExporter.js';

export function buildExportScene(house) {
  const out = new THREE.Group();
  out.name = 'IMAX_GT_Theater';

  for (const child of house.group.children) {
    if (child.isInstancedMesh) {
      const holder = new THREE.Group();
      holder.name = child.name;
      const m = new THREE.Matrix4();
      for (let i = 0; i < child.count; i++) {
        child.getMatrixAt(i, m);
        const mesh = new THREE.Mesh(child.geometry, child.material);
        m.decompose(mesh.position, mesh.quaternion, mesh.scale);
        mesh.name = `${child.name}_${i}`;
        holder.add(mesh);
      }
      out.add(holder);
    } else if (child === house.screen) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x080a10,
        emissive: new THREE.Color(0x2f5ea8),
        emissiveIntensity: 1.5,
        roughness: 0.95,
        metalness: 0.0,
      });
      const mesh = new THREE.Mesh(child.geometry, mat);
      mesh.position.copy(child.position);
      mesh.quaternion.copy(child.quaternion);
      mesh.name = 'screen';
      out.add(mesh);
    } else if (child.isMesh) {
      const clone = new THREE.Mesh(child.geometry, child.material);
      clone.position.copy(child.position);
      clone.quaternion.copy(child.quaternion);
      clone.scale.copy(child.scale);
      clone.name = child.name || 'mesh';
      out.add(clone);
    } else if (child.isPointLight || child.isDirectionalLight || child.isSpotLight) {
      out.add(child.clone());
    }
    // RectAreaLight and HemisphereLight have no glTF equivalent; the emissive
    // screen panel carries the intent instead.
  }
  return out;
}

export function exportGLB(house) {
  return new Promise((resolve, reject) => {
    const exporter = new GLTFExporter();
    exporter.parse(
      buildExportScene(house),
      resolve,
      reject,
      { binary: true, maxTextureSize: 1024 },
    );
  });
}
