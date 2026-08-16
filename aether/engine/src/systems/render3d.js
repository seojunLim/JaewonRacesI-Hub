/**
 * Render3DSystem — turns 3D components into mesh draw commands.
 *
 * Same shape as the 2D render system: pick the active camera, gather lights,
 * cull, sort, and emit plain command objects for the backend. Because the
 * commands are data, the headless backend records them and a test can assert
 * "the goal platform was drawn at (0, 0, -20)" with no GPU involved.
 *
 * It runs *before* the 2D render system in the same phase, so a 2D HUD composes
 * over the 3D world automatically.
 */

import { Phase, Order, defineSystem } from '../core/system.js';
import { RENDERER_RESOURCE } from './render.js';
import * as Mat4 from '../math/mat4.js';
import * as Vec3 from '../math/vec3.js';
import * as Quat from '../math/quat.js';
import { DEG2RAD } from '../math/scalar.js';
import { getPrimitive } from '../render/mesh.js';

/**
 * Pick the camera to render with: the active Camera3D with the highest
 * priority, ties broken by entity id so the choice never flickers.
 */
export function activeCamera3D(world) {
  let best = null;
  for (const [entity, camera] of world.each('Camera3D')) {
    if (!camera.active) continue;
    const better =
      !best ||
      camera.priority > best.camera.priority ||
      (camera.priority === best.camera.priority && entity.id < best.entity.id);
    if (better) {
      best = { entity, camera, transform: entity.get('WorldTransform3D') };
    }
  }
  return best?.transform ? best : null;
}

/**
 * Compute the view parameters for a 3D camera.
 *
 * @returns {object} view and projection matrices plus everything culling and
 * the headless ASCII projection need.
 */
export function computeView3D(camera, worldTransform, surfaceWidth, surfaceHeight) {
  const viewport = camera.viewport ?? { x: 0, y: 0, w: 1, h: 1 };
  const pixelWidth = Math.max(1, Math.round(surfaceWidth * viewport.w));
  const pixelHeight = Math.max(1, Math.round(surfaceHeight * viewport.h));
  const aspect = pixelWidth / pixelHeight;

  const projection = Mat4.create();
  if (camera.projection === 'orthographic') {
    const halfHeight = camera.orthoSize;
    const halfWidth = halfHeight * aspect;
    Mat4.ortho(projection, -halfWidth, halfWidth, -halfHeight, halfHeight, camera.near, camera.far);
  } else {
    Mat4.perspective(projection, camera.fov * DEG2RAD, aspect, camera.near, camera.far);
  }

  // The view matrix is the inverse of the camera's world transform. A rigid
  // inverse is both faster and more stable than a general one, and a camera
  // with a scale is a mistake rather than a feature.
  const view = Mat4.invertRigid(Mat4.create(), worldTransform.matrix);

  const viewProjection = Mat4.multiply(Mat4.create(), projection, view);

  const forward = Quat.rotateVec3(worldTransform.quaternion, Vec3.FORWARD);

  return {
    projection,
    view,
    viewProjection,
    position: { ...worldTransform.position },
    forward,
    near: camera.near,
    far: camera.far,
    fov: camera.fov,
    aspect,
    orthographic: camera.projection === 'orthographic',
    orthoSize: camera.orthoSize,
    background: camera.background,
    fogColor: camera.fogColor,
    fogDensity: camera.fogDensity,
    viewport,
    pixelX: Math.round(surfaceWidth * viewport.x),
    pixelY: Math.round(surfaceHeight * viewport.y),
    pixelWidth,
    pixelHeight,
  };
}

/**
 * Resolve the scene's lights into a flat list the backend can upload.
 *
 * A directional light's `vector` is the direction it *travels* (the entity's
 * forward, -z); a point light's is its world position. Collapsing both into one
 * field keeps the shader's uniform block small.
 */
export function gatherLights(world) {
  const lights = [];
  for (const [entity, light, wt] of world.each('Light', 'WorldTransform3D')) {
    if (!light.enabled || light.intensity <= 0) continue;
    const vector =
      light.type === 'point'
        ? { ...wt.position }
        : Quat.rotateVec3(wt.quaternion, Vec3.FORWARD);
    lights.push({
      entityId: entity.id,
      type: light.type,
      vector,
      color: light.color,
      intensity: light.intensity,
      range: light.range,
    });
  }
  // Stable order: the shader iterates lights, and reordering them between
  // frames would make the lighting shimmer.
  lights.sort((a, b) => a.entityId - b.entityId);
  return lights;
}

const tempScale = Vec3.vec3();

/**
 * Build and sort the frame's 3D draw commands.
 *
 * Exported so tests and the editor can inspect a frame without a renderer.
 */
export function buildMeshDrawList(world, view) {
  const list = [];

  for (const [entity, renderer, wt] of world.each('MeshRenderer', 'WorldTransform3D')) {
    if (!renderer.visible || renderer.opacity <= 0) continue;

    const mesh = getPrimitive(renderer.mesh);
    // An unknown mesh name would otherwise draw nothing with no explanation.
    if (!mesh && !world.getResource('assets')?.get(renderer.mesh)) continue;

    // `size` scales the unit primitive; the transform's scale then applies on
    // top, so both a 2x2x2 `size` and a scale of 2 do what they look like.
    tempScale.x = renderer.size.x * wt.scale.x;
    tempScale.y = renderer.size.y * wt.scale.y;
    tempScale.z = renderer.size.z * wt.scale.z;

    const matrix = Mat4.fromTRS(Mat4.create(), wt.position, wt.quaternion, tempScale);

    // Cull against the far plane and behind the camera using the bounding
    // sphere. A full frustum test is not worth the code at these scene sizes.
    const radius = 0.5 * Math.hypot(tempScale.x, tempScale.y, tempScale.z);
    const toObject = Vec3.sub(wt.position, view.position);
    const along = Vec3.dot(toObject, view.forward);
    if (along < -radius || along > view.far + radius) continue;

    list.push({
      type: 'mesh',
      entityId: entity.id,
      entityName: entity.name,
      mesh: renderer.mesh,
      matrix,
      // Kept alongside the matrix so headless assertions and the ASCII view do
      // not have to decompose it.
      x: wt.position.x,
      y: wt.position.y,
      z: wt.position.z,
      radius,
      // Per-axis world extents. The bounding *radius* is right for culling but
      // wrong for anything that needs the object's shape — a 20x1x20 floor has
      // a radius of 14, and drawing it as a 14-unit cube is very misleading in
      // the headless ASCII view.
      halfExtents: { x: tempScale.x / 2, y: tempScale.y / 2, z: tempScale.z / 2 },
      depth: along,
      color: renderer.color,
      texture: renderer.texture,
      opacity: renderer.opacity,
      shininess: renderer.shininess,
      emissive: renderer.emissive,
      doubleSided: renderer.doubleSided,
      layer: renderer.layer,
      transparent: renderer.opacity < 1 || renderer.color.a < 1,
    });
  }

  // Opaque front-to-back (early-z rejects hidden fragments), then transparent
  // back-to-front (alpha blending is order-dependent). Entity id breaks ties so
  // the order never flickers between frames.
  list.sort((a, b) => {
    if (a.transparent !== b.transparent) return a.transparent ? 1 : -1;
    if (a.layer !== b.layer) return a.layer - b.layer;
    const byDepth = a.transparent ? b.depth - a.depth : a.depth - b.depth;
    if (Math.abs(byDepth) > 1e-6) return byDepth;
    return a.entityId - b.entityId;
  });
  return list;
}

export const Render3DSystem = defineSystem({
  name: 'Render3DSystem',
  phase: Phase.RENDER,
  order: Order.EARLY,
  description:
    'Renders MeshRenderer entities through the active Camera3D, with lighting and fog. ' +
    'Runs before RenderSystem so a 2D HUD composes on top of the 3D world.',
  reads: ['Camera3D', 'MeshRenderer', 'Light', 'WorldTransform3D', 'Skybox'],
  update({ world }) {
    const renderer = world.getResource(RENDERER_RESOURCE);
    // Not every backend does 3D — the plain 2D renderers do not.
    if (!renderer?.begin3D) return;

    const cam = activeCamera3D(world);
    if (!cam) return;

    const view = computeView3D(cam.camera, cam.transform, renderer.width, renderer.height);
    const lights = gatherLights(world);
    const skybox = world.singleton('Skybox') ?? null;
    const drawList = buildMeshDrawList(world, view);

    renderer.begin3D(view, lights, skybox);
    for (const command of drawList) renderer.submitMesh(command);
    renderer.end3D();
  },
});

/**
 * Project a world point to normalized device coordinates.
 *
 * Returns `null` when the point is behind the camera. Used by the headless
 * ASCII view and by anything placing a 2D marker over a 3D object.
 */
export function projectToNDC(view, point, out = { x: 0, y: 0, z: 0 }) {
  const m = view.viewProjection;
  const { x, y, z } = point;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (w <= 1e-6) return null;
  out.x = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  out.y = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  out.z = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
  return out;
}

/**
 * A world-space ray through a screen pixel. The 3D equivalent of
 * `screenToWorld`, and what mouse picking needs.
 *
 * @returns {{origin: {x,y,z}, direction: {x,y,z}}}
 */
export function screenToRay(view, screenX, screenY) {
  const ndcX = ((screenX - view.pixelX) / view.pixelWidth) * 2 - 1;
  const ndcY = 1 - ((screenY - view.pixelY) / view.pixelHeight) * 2;

  const inverse = Mat4.invert(Mat4.create(), view.viewProjection);
  if (!inverse) {
    return { origin: { ...view.position }, direction: { ...view.forward } };
  }

  const near = Mat4.transformPoint(inverse, { x: ndcX, y: ndcY, z: -1 });
  const far = Mat4.transformPoint(inverse, { x: ndcX, y: ndcY, z: 1 });

  const direction = Vec3.normalize(Vec3.sub(far, near));
  // For an orthographic camera every ray is parallel, so the origin moves
  // rather than the direction.
  return { origin: view.orthographic ? near : { ...view.position }, direction };
}
