import * as THREE from 'three';
import { buildCaps, disposeCaps } from './section-caps.js';

// A unit cube cut through its middle produces one cap mesh with 6
// triangles: each side face contributes 2 segments, welding into an
// 8-node square loop that earcut triangulates to n-2 = 6 triangles.
const solid = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x00d4aa }),
);
const group = new THREE.Group();
group.add(solid);

const parts = [{ group, solid }];
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const caps = buildCaps(parts, plane);

let tris = 0;
caps.traverse((o) => {
  if (o.geometry) tris += o.geometry.attributes.position.count / 3;
});
console.log(`caps: ${caps.children.length} mesh(es), ${tris} triangles`);

disposeCaps(caps);
