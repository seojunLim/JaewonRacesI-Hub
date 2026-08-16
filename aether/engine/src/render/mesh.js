/**
 * Meshes and built-in primitives.
 *
 * A mesh is interleaved vertex data plus an index buffer, in the layout the
 * WebGL renderer uploads directly:
 *
 *   position  3 x float32
 *   normal    3 x float32
 *   uv        2 x float32
 *
 * Primitives are generated rather than loaded so a 3D scene needs no asset
 * files at all — the same property that lets a 2D scene use `ShapeRenderer` and
 * be playable immediately. Generation is deterministic and cached by name, so
 * a thousand boxes share one buffer.
 *
 * @typedef {object} Mesh
 * @property {string} name
 * @property {Float32Array} vertices  interleaved position/normal/uv
 * @property {Uint16Array|Uint32Array} indices
 * @property {number} vertexCount
 * @property {{min: {x,y,z}, max: {x,y,z}}} bounds  local-space AABB
 */

export const FLOATS_PER_VERTEX = 8;

/** Names accepted by `MeshRenderer.mesh`. */
export const PRIMITIVE_NAMES = ['box', 'sphere', 'plane', 'quad', 'cylinder', 'cone'];

const cache = new Map();

/**
 * Get a primitive by name, generating and caching it on first use.
 * @param {string} name
 * @returns {Mesh|null} null for an unknown name
 */
export function getPrimitive(name) {
  if (cache.has(name)) return cache.get(name);
  const builder = BUILDERS[name];
  if (!builder) return null;
  const mesh = builder();
  cache.set(name, mesh);
  return mesh;
}

/** Build a mesh record from raw arrays, computing its bounds. */
export function createMesh(name, vertices, indices) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < vertices.length; i += FLOATS_PER_VERTEX) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];
    if (x < min.x) min.x = x;
    if (y < min.y) min.y = y;
    if (z < min.z) min.z = z;
    if (x > max.x) max.x = x;
    if (y > max.y) max.y = y;
    if (z > max.z) max.z = z;
  }
  return {
    name,
    vertices,
    indices,
    vertexCount: vertices.length / FLOATS_PER_VERTEX,
    indexCount: indices.length,
    bounds: { min, max },
  };
}

// ---------------------------------------------------------------------------
// Primitives — all unit-sized and centered on the origin, so `MeshRenderer.size`
// maps directly to world units.
// ---------------------------------------------------------------------------

/** A 1x1x1 cube with hard edges (24 vertices, so each face gets its own normal). */
function buildBox() {
  const h = 0.5;
  // Per face: normal, then four corners in counter-clockwise winding.
  const faces = [
    { n: [0, 0, 1], c: [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]] },
    { n: [0, 0, -1], c: [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]] },
    { n: [1, 0, 0], c: [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]] },
    { n: [-1, 0, 0], c: [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]] },
    { n: [0, 1, 0], c: [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]] },
    { n: [0, -1, 0], c: [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]] },
  ];

  const vertices = new Float32Array(24 * FLOATS_PER_VERTEX);
  const indices = new Uint16Array(36);
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];

  let v = 0;
  let i = 0;
  faces.forEach((face, faceIndex) => {
    const base = faceIndex * 4;
    for (let corner = 0; corner < 4; corner++) {
      vertices[v++] = face.c[corner][0];
      vertices[v++] = face.c[corner][1];
      vertices[v++] = face.c[corner][2];
      vertices[v++] = face.n[0];
      vertices[v++] = face.n[1];
      vertices[v++] = face.n[2];
      vertices[v++] = uvs[corner][0];
      vertices[v++] = uvs[corner][1];
    }
    indices[i++] = base;
    indices[i++] = base + 1;
    indices[i++] = base + 2;
    indices[i++] = base;
    indices[i++] = base + 2;
    indices[i++] = base + 3;
  });

  return createMesh('box', vertices, indices);
}

/** A UV sphere of diameter 1. */
function buildSphere(segments = 24, rings = 16) {
  const vertices = [];
  const indices = [];
  const radius = 0.5;

  for (let ring = 0; ring <= rings; ring++) {
    const phi = (ring / rings) * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    for (let segment = 0; segment <= segments; segment++) {
      const theta = (segment / segments) * Math.PI * 2;
      const nx = sinPhi * Math.cos(theta);
      const ny = cosPhi;
      const nz = sinPhi * Math.sin(theta);

      vertices.push(nx * radius, ny * radius, nz * radius, nx, ny, nz, segment / segments, 1 - ring / rings);
    }
  }

  for (let ring = 0; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const a = ring * (segments + 1) + segment;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  return createMesh('sphere', new Float32Array(vertices), new Uint16Array(indices));
}

/** A 1x1 horizontal plane in the xz plane, facing +y. Ground and floors. */
function buildPlane(divisions = 1) {
  const vertices = [];
  const indices = [];
  const h = 0.5;

  for (let z = 0; z <= divisions; z++) {
    for (let x = 0; x <= divisions; x++) {
      const px = -h + (x / divisions);
      const pz = -h + (z / divisions);
      vertices.push(px, 0, pz, 0, 1, 0, x / divisions, z / divisions);
    }
  }
  for (let z = 0; z < divisions; z++) {
    for (let x = 0; x < divisions; x++) {
      const a = z * (divisions + 1) + x;
      const b = a + divisions + 1;
      // Counter-clockwise seen from +y.
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return createMesh('plane', new Float32Array(vertices), new Uint16Array(indices));
}

/** A 1x1 vertical quad in the xy plane, facing +z. Billboards and walls. */
function buildQuad() {
  const h = 0.5;
  const vertices = new Float32Array([
    -h, -h, 0, 0, 0, 1, 0, 0,
    h, -h, 0, 0, 0, 1, 1, 0,
    h, h, 0, 0, 0, 1, 1, 1,
    -h, h, 0, 0, 0, 1, 0, 1,
  ]);
  return createMesh('quad', vertices, new Uint16Array([0, 1, 2, 0, 2, 3]));
}

/** A cylinder of diameter 1 and height 1, aligned to y. */
function buildCylinder(segments = 24) {
  return buildCone(segments, 0.5, 0.5, 'cylinder');
}

/** A cone of base diameter 1 and height 1, aligned to y. */
function buildConeMesh(segments = 24) {
  return buildCone(segments, 0, 0.5, 'cone');
}

/**
 * Shared cylinder/cone body.
 * @param {number} topRadius 0 produces a cone
 */
function buildCone(segments, topRadius, bottomRadius, name) {
  const vertices = [];
  const indices = [];
  const halfHeight = 0.5;

  // Side wall. The normal tilts with the slope so a cone lights correctly.
  const slope = Math.atan2(bottomRadius - topRadius, 1);
  const cosSlope = Math.cos(slope);
  const sinSlope = Math.sin(slope);

  for (let s = 0; s <= segments; s++) {
    const theta = (s / segments) * Math.PI * 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const nx = cos * cosSlope;
    const ny = sinSlope;
    const nz = sin * cosSlope;

    vertices.push(cos * topRadius, halfHeight, sin * topRadius, nx, ny, nz, s / segments, 1);
    vertices.push(cos * bottomRadius, -halfHeight, sin * bottomRadius, nx, ny, nz, s / segments, 0);
  }
  for (let s = 0; s < segments; s++) {
    const a = s * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  // Caps, as separate fans so their normals stay flat.
  const addCap = (y, radius, normalY) => {
    if (radius <= 0) return;
    const center = vertices.length / FLOATS_PER_VERTEX;
    vertices.push(0, y, 0, 0, normalY, 0, 0.5, 0.5);
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      vertices.push(cos * radius, y, sin * radius, 0, normalY, 0, 0.5 + cos * 0.5, 0.5 + sin * 0.5);
    }
    for (let s = 0; s < segments; s++) {
      const a = center + 1 + s;
      if (normalY > 0) indices.push(center, a + 1, a);
      else indices.push(center, a, a + 1);
    }
  };
  addCap(halfHeight, topRadius, 1);
  addCap(-halfHeight, bottomRadius, -1);

  return createMesh(name, new Float32Array(vertices), new Uint16Array(indices));
}

const BUILDERS = {
  box: buildBox,
  sphere: () => buildSphere(),
  plane: () => buildPlane(1),
  quad: buildQuad,
  cylinder: () => buildCylinder(),
  cone: () => buildConeMesh(),
};

/**
 * A subdivided ground plane. Flat-shaded geometry with one quad shows visible
 * banding under a point light; more vertices fix it without a shader change.
 */
export function subdividedPlane(divisions = 16) {
  const key = `plane:${divisions}`;
  if (cache.has(key)) return cache.get(key);
  const mesh = buildPlane(divisions);
  mesh.name = key;
  cache.set(key, mesh);
  return mesh;
}

/** Every primitive, for the editor's mesh dropdown and `sjl describe`. */
export function primitiveNames() {
  return [...PRIMITIVE_NAMES];
}
