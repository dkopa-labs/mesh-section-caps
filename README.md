# mesh-section-caps

Closed section-contour extraction and cap triangulation for triangle meshes — the same code that fills the cross-section view in the [DKOPA viewer](https://dkopa.com/viewer), published standalone.

When a clipping plane cuts a model, stock `clippingPlanes` shows a hollow shell. This library computes the actual intersection — plane ∩ triangles → welded segments → closed loops (with holes) → `earcut` triangulation — and returns cap geometry you can attach to the scene.

```js
import * as THREE from 'three';
import { buildCaps, disposeCaps } from 'mesh-section-caps';

const parts = [{ group, solid }];            // meshes to cap
const plane = new THREE.Plane(n, constant);  // the same plane clipping your materials

const caps = buildCaps(parts, plane);        // THREE.Group of cap meshes
scene.add(caps);
disposeCaps(caps);                           // when rebuilding or removing
```

### How it works

1. **Intersect** — for each triangle straddling the plane, emit the intersection segment between its two crossing edges. Vertex-on-plane and coplanar-edge cases are handled, so coarse tessellations don't produce gaps.
2. **Weld & chain** — endpoints are welded on a spatial grid and chained into loops. Open chains (non-watertight cuts) are dropped rather than filled.
3. **Triangulate** — loops are projected to the plane's 2D basis; larger-area loops containing smaller ones become outer rings with holes, then `earcut` produces the cap triangles.

Caps inherit each part's material color and use polygon offset to avoid z-fighting with the clip plane.

### Notes

- Mesh-level caps — this is triangle-soup intersection, not a B-rep Boolean. For exact CAD sections you need the kernel.
- Per part, not per scene — pass the same parts you clip so visibility toggles are respected.
- Rebuild on plane changes (debounced — ~100ms feels right for interactive sliders).

### Demo

```bash
npm install
npm run demo   # caps a unit cube at y=0 → 1 mesh, 6 triangles
```

MIT — [DKOPA](https://dkopa.com)
