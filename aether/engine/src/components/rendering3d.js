/**
 * 3D rendering components.
 *
 * Like their 2D counterparts these describe *what* to draw, never *how*. The
 * render system reads them and emits draw commands; the backend rasterizes or,
 * headlessly, records them.
 */

import { defineComponent } from '../core/component.js';
import { PRIMITIVE_NAMES } from '../render/mesh.js';

export const MeshRenderer = defineComponent({
  name: 'MeshRenderer',
  category: 'Rendering 3D',
  requires: ['Transform3D'],
  description:
    'Draws a mesh. `mesh` names a built-in primitive (box, sphere, plane, cylinder, ' +
    'cone, quad) or an asset id. Materials are a deliberately small set: a color, ' +
    'an optional texture, and two lighting knobs.',
  schema: {
    mesh: {
      type: 'string',
      default: 'box',
      description: `Primitive name (${PRIMITIVE_NAMES.join(', ')}) or a mesh asset id`,
    },
    color: { type: 'color', default: '#cccccc', description: 'Base color, multiplied with the texture' },
    texture: { type: 'asset', assetType: 'texture', description: 'Optional albedo texture' },
    /** 0 = fully matte, 1 = a tight specular highlight. */
    shininess: { type: 'number', default: 0.25, min: 0, max: 1, description: 'Specular tightness' },
    /** Light that reaches the surface regardless of direction. Keeps shadows readable. */
    emissive: { type: 'number', default: 0, min: 0, max: 1, description: 'Self-illumination, 0..1' },
    opacity: { type: 'number', default: 1, min: 0, max: 1 },
    /** Backface culling. Turn it off for planes you want visible from both sides. */
    doubleSided: { type: 'boolean', default: false },
    castShadow: { type: 'boolean', default: true, description: 'Reserved; the forward renderer ignores it' },
    visible: { type: 'boolean', default: true },
    layer: { type: 'int', default: 0, description: 'Sort layer; transparent meshes sort back-to-front' },
    /** Uniform scale applied to the mesh before the transform. Handy for primitives. */
    size: { type: 'vec3', default: [1, 1, 1], description: 'Mesh size in world units' },
  },
});

export const Camera3D = defineComponent({
  name: 'Camera3D',
  category: 'Rendering 3D',
  requires: ['Transform3D'],
  description:
    'A perspective (or orthographic) view onto the 3D world. The active camera with ' +
    'the highest priority wins. An unrotated camera looks down -z.',
  schema: {
    projection: { type: 'enum', values: ['perspective', 'orthographic'], default: 'perspective' },
    fov: { type: 'number', default: 60, min: 1, max: 179, description: 'Vertical field of view, in degrees' },
    /** Orthographic half-height, mirroring the 2D camera's `size`. */
    orthoSize: { type: 'number', default: 5, min: 0.01, description: 'Half the visible height, orthographic only' },
    near: { type: 'number', default: 0.1, min: 0.0001, description: 'Near clip plane' },
    far: { type: 'number', default: 1000, min: 0.001, description: 'Far clip plane' },
    background: { type: 'color', default: '#0d1117' },
    active: { type: 'boolean', default: true },
    priority: { type: 'int', default: 0 },
    viewport: {
      type: 'object',
      default: { x: 0, y: 0, w: 1, h: 1 },
      description: 'Normalized 0..1 screen rect, for split screen',
      fields: {
        x: { type: 'number', default: 0, min: 0, max: 1 },
        y: { type: 'number', default: 0, min: 0, max: 1 },
        w: { type: 'number', default: 1, min: 0, max: 1 },
        h: { type: 'number', default: 1, min: 0, max: 1 },
      },
    },
    /** Distance-based fade toward the background color. 0 disables it. */
    fogDensity: { type: 'number', default: 0, min: 0, max: 1, description: 'Exponential fog, 0 = off' },
    fogColor: { type: 'color', default: '#0d1117' },
  },
});

export const Light = defineComponent({
  name: 'Light',
  category: 'Rendering 3D',
  requires: ['Transform3D'],
  description:
    'A light source.\n' +
    '  directional — infinitely far, shines along the entity\'s forward (-z). The sun.\n' +
    '  point       — radiates from the entity position, falling off over `range`.\n' +
    '  ambient     — uniform fill from every direction; position and rotation are ignored.',
  schema: {
    type: { type: 'enum', values: ['directional', 'point', 'ambient'], default: 'directional' },
    color: { type: 'color', default: '#ffffff' },
    intensity: { type: 'number', default: 1, min: 0 },
    range: { type: 'number', default: 20, min: 0.01, description: 'Point lights only' },
    enabled: { type: 'boolean', default: true },
  },
});

export const Skybox = defineComponent({
  name: 'Skybox',
  category: 'Rendering 3D',
  singleton: true,
  description:
    'A vertical gradient behind the scene. Cheap, and enough to make a 3D scene read ' +
    'as a space rather than a void — which a flat clear color does not.',
  schema: {
    top: { type: 'color', default: '#1b2a4a' },
    bottom: { type: 'color', default: '#0a0d14' },
    /** Where the horizon sits, as a fraction of the screen height. */
    horizon: { type: 'number', default: 0.5, min: 0, max: 1 },
    enabled: { type: 'boolean', default: true },
  },
});

export const CameraOrbit = defineComponent({
  name: 'CameraOrbit',
  category: 'Rendering 3D',
  requires: ['Transform3D'],
  description:
    'Orbits the camera around a target entity at a fixed distance. The standard ' +
    'third-person / inspection camera.',
  schema: {
    target: { type: 'entity', description: 'Scene id of the entity to orbit' },
    targetOffset: { type: 'vec3', default: [0, 0, 0], description: 'Offset from the target position' },
    distance: { type: 'number', default: 8, min: 0.01 },
    /** Horizontal angle, degrees. 0 places the camera on +z looking toward -z. */
    yaw: { type: 'number', default: 0 },
    /** Vertical angle, degrees. Positive looks down at the target. */
    pitch: { type: 'number', default: 20, min: -89, max: 89 },
    halfLife: { type: 'number', default: 0.08, min: 0, description: 'Position smoothing half-life' },
    /** Let the mouse drag the camera around. */
    mouseControl: { type: 'boolean', default: false },
    sensitivity: { type: 'number', default: 0.25, min: 0, description: 'Degrees per pixel of mouse movement' },
    /** Scroll wheel zoom limits. */
    minDistance: { type: 'number', default: 2, min: 0.01 },
    maxDistance: { type: 'number', default: 40, min: 0.01 },
    zoomSpeed: { type: 'number', default: 1, min: 0 },
  },
});
