import * as THREE from 'three';
import earcut from 'earcut';

const EPS = 1e-9;
const Q = 1e5;

function weldKey(x, y, z) {
  return `${Math.round(x * Q)},${Math.round(y * Q)},${Math.round(z * Q)}`;
}

// Plane ∩ triangle soup → segment list with welded endpoints, deduped
// across faces that sample the same edge twice.
function intersectMesh(pos, index, plane) {
  const n = plane.normal;
  const d = plane.constant;
  const triCount = index ? index.length / 3 : pos.length / 9;
  const nodeId = new Map();
  const nodePos = [];
  const segs = [];

  const node = (x, y, z) => {
    const k = weldKey(x, y, z);
    let id = nodeId.get(k);
    if (id === undefined) {
      id = nodePos.length / 3;
      nodeId.set(k, id);
      nodePos.push(x, y, z);
    }
    return id;
  };

  const dist = (i) =>
    n.x * pos[i * 3] + n.y * pos[i * 3 + 1] + n.z * pos[i * 3 + 2] + d;

  const lerpPt = (a, b, ta, tb) => {
    const t = ta / (ta - tb);
    return [
      pos[a * 3] + (pos[b * 3] - pos[a * 3]) * t,
      pos[a * 3 + 1] + (pos[b * 3 + 1] - pos[a * 3 + 1]) * t,
      pos[a * 3 + 2] + (pos[b * 3 + 2] - pos[a * 3 + 2]) * t,
    ];
  };
  const vpos = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];

  const seen = new Set();
  for (let t = 0; t < triCount; t++) {
    const tri = index
      ? [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]]
      : [t * 3, t * 3 + 1, t * 3 + 2];
    const dd = tri.map(dist);
    // Candidate section points: strict crossings, vertices lying on the
    // plane, and coplanar edges whose third vertex is on the clipped side.
    const pts = [];
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const c = tri[(e + 2) % 3];
      const da = dd[e];
      const db = dd[(e + 1) % 3];
      const dc = dd[(e + 2) % 3];
      if (Math.abs(da) < EPS && Math.abs(db) < EPS) {
        if (dc < -EPS) {
          pts.push(vpos(a), vpos(b));
        }
        continue;
      }
      if (Math.abs(da) < EPS) pts.push(vpos(a));
      if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
        pts.push(lerpPt(a, b, da, db));
      }
    }
    if (pts.length < 2) continue;
    // A plane ∩ triangle is one segment — take the two farthest points.
    let pa = 0;
    let pb = 1;
    let best = -1;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const s =
          (pts[i][0] - pts[j][0]) ** 2 +
          (pts[i][1] - pts[j][1]) ** 2 +
          (pts[i][2] - pts[j][2]) ** 2;
        if (s > best) {
          best = s;
          pa = i;
          pb = j;
        }
      }
    }
    const na = node(...pts[pa]);
    const nb = node(...pts[pb]);
    if (na === nb) continue;
    const sk = na < nb ? na * 1e9 + nb : nb * 1e9 + na;
    if (seen.has(sk)) continue; // same edge sampled by two faces
    seen.add(sk);
    segs.push(na, nb);
  }
  return { segs, nodePos };
}

// Chain welded segments into closed loops. Open chains are dropped —
// a cap needs a closed boundary.
function chainLoops(segs) {
  const adj = new Map();
  for (let s = 0; s < segs.length; s += 2) {
    for (const n of [segs[s], segs[s + 1]]) {
      let l = adj.get(n);
      if (!l) adj.set(n, (l = []));
      l.push(s);
    }
  }
  const used = new Set();
  const loops = [];
  for (let s = 0; s < segs.length; s += 2) {
    if (used.has(s)) continue;
    const start = segs[s];
    const loop = [start];
    let node = segs[s + 1];
    used.add(s);
    while (true) {
      loop.push(node);
      const next = adj.get(node).find((c) => !used.has(c));
      if (next === undefined) break;
      used.add(next);
      node = segs[next] === node ? segs[next + 1] : segs[next];
      if (node === start) {
        loops.push(loop);
        break;
      }
    }
  }
  return loops;
}

function pointInLoop(px, py, pts2, start, count) {
  let inside = false;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = pts2[(start + i) * 2];
    const yi = pts2[(start + i) * 2 + 1];
    const xj = pts2[(start + j) * 2];
    const yj = pts2[(start + j) * 2 + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Triangulate closed loops on the plane. Loops containing other loops
// get them passed to earcut as holes.
function triangulate(loops, nodePos, plane) {
  const n = plane.normal;
  const ref = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(n, ref).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);

  const proj = (i) => {
    const x = nodePos[i * 3];
    const y = nodePos[i * 3 + 1];
    const z = nodePos[i * 3 + 2];
    return [x * u.x + y * u.y + z * u.z, x * v.x + y * v.y + z * v.z];
  };

  const flat = loops.map((loop) => loop.flatMap(proj));
  // Containment depth: even → outer boundary, odd → hole.
  const depth = flat.map((pts, i) => {
    let d = 0;
    for (let j = 0; j < flat.length; j++) {
      if (i !== j && pointInLoop(pts[0], pts[1], flat[j], 0, flat[j].length / 2)) d++;
    }
    return d;
  });

  const positions = [];
  for (let i = 0; i < loops.length; i++) {
    if (depth[i] % 2 !== 0) continue; // holes ride along with their outer
    const pts2 = [...flat[i]];
    const nodes = [...loops[i]];
    const holes = [];
    for (let j = 0; j < loops.length; j++) {
      if (depth[j] === depth[i] + 1 &&
          pointInLoop(flat[j][0], flat[j][1], flat[i], 0, flat[i].length / 2)) {
        holes.push(pts2.length / 2);
        pts2.push(...flat[j]);
        nodes.push(...loops[j]);
      }
    }
    const tris = earcut(pts2, holes.length ? holes : null);
    for (const ti of tris) {
      const ni = nodes[ti];
      positions.push(nodePos[ni * 3], nodePos[ni * 3 + 1], nodePos[ni * 3 + 2]);
    }
  }
  return positions;
}

export function buildCaps(parts, plane) {
  const group = new THREE.Group();
  for (const part of parts) {
    if (!part.group.visible || !part.solid) continue;
    const geo = part.solid.geometry;
    const pos = geo.attributes.position.array;
    const index = geo.index ? geo.index.array : null;
    const { segs, nodePos } = intersectMesh(pos, index, plane);
    if (segs.length === 0) continue;
    const loops = chainLoops(segs);
    if (loops.length === 0) continue;
    const positions = triangulate(loops, nodePos, plane);
    if (positions.length === 0) continue;

    const capGeo = new THREE.BufferGeometry();
    capGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    capGeo.computeVertexNormals();
    const capMat = new THREE.MeshStandardMaterial({
      color: part.solid.material.color,
      metalness: 0.1,
      roughness: 0.75,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    group.add(new THREE.Mesh(capGeo, capMat));
  }
  return group;
}

export function disposeCaps(group) {
  if (!group) return;
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}
