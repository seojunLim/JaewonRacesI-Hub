/**
 * Rendering components.
 *
 * These describe *what* to draw, never *how*. The render systems read them and
 * talk to whichever backend is installed (WebGL2, Canvas2D, or the headless
 * recorder), which is why the exact same scene file can be rendered to a canvas
 * or asserted against in a Node test.
 */

import { defineComponent } from '../core/component.js';

export const Sprite = defineComponent({
  name: 'Sprite',
  category: 'Rendering',
  requires: ['Transform'],
  description: 'Draws a texture (or a solid color, if no texture is set) at the entity transform.',
  schema: {
    texture: {
      type: 'asset',
      assetType: 'texture',
      description: 'Asset id from the scene `assets` list. Omit for an untextured colored quad.',
    },
    frame: {
      type: 'string',
      default: '',
      description: 'Named region within an atlas texture. Empty means the whole texture.',
    },
    color: { type: 'color', default: '#ffffff', description: 'Tint, multiplied with the texture' },
    size: {
      type: 'vec2',
      default: [1, 1],
      description: 'Size in world units before Transform.scale is applied',
    },
    anchor: {
      type: 'vec2',
      default: [0.5, 0.5],
      description: 'Pivot within the sprite: [0,0] bottom-left, [0.5,0.5] center, [1,1] top-right',
    },
    flipX: { type: 'boolean', default: false },
    flipY: { type: 'boolean', default: false },
    layer: {
      type: 'int',
      default: 0,
      description: 'Sort layer. Higher draws on top. Ties broken by `order`, then entity id.',
    },
    order: { type: 'int', default: 0, description: 'Sort order within the layer' },
    opacity: { type: 'number', default: 1, min: 0, max: 1 },
    visible: { type: 'boolean', default: true },
  },
});

export const ShapeRenderer = defineComponent({
  name: 'ShapeRenderer',
  category: 'Rendering',
  requires: ['Transform'],
  description:
    'Draws a primitive shape. Useful for prototypes, debug visuals and games ' +
    'that never load an image at all.',
  schema: {
    shape: { type: 'enum', values: ['rectangle', 'circle', 'line', 'polygon'], default: 'rectangle' },
    size: { type: 'vec2', default: [1, 1], description: 'Width/height; for a circle, x is the diameter' },
    color: { type: 'color', default: '#ffffff' },
    filled: { type: 'boolean', default: true },
    thickness: { type: 'number', default: 0.05, min: 0, description: 'Outline width in world units' },
    points: {
      type: 'array',
      items: { type: 'vec2' },
      default: [],
      description: 'Vertices for `line` and `polygon`, in local space',
    },
    anchor: { type: 'vec2', default: [0.5, 0.5] },
    layer: { type: 'int', default: 0 },
    order: { type: 'int', default: 0 },
    opacity: { type: 'number', default: 1, min: 0, max: 1 },
    visible: { type: 'boolean', default: true },
  },
});

export const Text = defineComponent({
  name: 'Text',
  category: 'Rendering',
  requires: ['Transform'],
  description: 'Draws a string. Uses the backend\'s text support; no font asset required.',
  schema: {
    text: { type: 'string', default: '', description: 'The string to draw' },
    font: { type: 'string', default: 'sans-serif' },
    size: { type: 'number', default: 0.5, min: 0, description: 'Cap height in world units' },
    color: { type: 'color', default: '#ffffff' },
    align: { type: 'enum', values: ['left', 'center', 'right'], default: 'center' },
    baseline: { type: 'enum', values: ['top', 'middle', 'bottom'], default: 'middle' },
    bold: { type: 'boolean', default: false },
    italic: { type: 'boolean', default: false },
    layer: { type: 'int', default: 10 },
    order: { type: 'int', default: 0 },
    opacity: { type: 'number', default: 1, min: 0, max: 1 },
    visible: { type: 'boolean', default: true },
    screenSpace: {
      type: 'boolean',
      default: false,
      description: 'Ignore the camera and position in screen units — for HUDs',
    },
  },
});

export const Camera = defineComponent({
  name: 'Camera',
  category: 'Rendering',
  requires: ['Transform'],
  description:
    'A view onto the world. Exactly one camera should be `active` at a time; ' +
    'the render system picks the active one with the highest priority.',
  schema: {
    /**
     * Orthographic half-height: the camera shows `size * 2` world units
     * vertically. Width follows from the viewport aspect ratio, which keeps the
     * framing identical on any window shape.
     */
    size: { type: 'number', default: 5, min: 0.01, description: 'Half the visible height, in world units' },
    background: { type: 'color', default: '#0d1117', description: 'Clear color' },
    active: { type: 'boolean', default: true },
    priority: { type: 'int', default: 0, description: 'Highest priority active camera wins' },
    zoom: { type: 'number', default: 1, min: 0.01 },
    /** Viewport rect in normalized 0..1 screen coordinates — for split screen. */
    viewport: { type: 'object', default: { x: 0, y: 0, w: 1, h: 1 }, fields: {
      x: { type: 'number', default: 0, min: 0, max: 1 },
      y: { type: 'number', default: 0, min: 0, max: 1 },
      w: { type: 'number', default: 1, min: 0, max: 1 },
      h: { type: 'number', default: 1, min: 0, max: 1 },
    } },
    bounds: {
      type: 'object',
      description: 'Optional world-space clamp for the camera center',
      fields: {
        enabled: { type: 'boolean', default: false },
        min: { type: 'vec2', default: [-100, -100] },
        max: { type: 'vec2', default: [100, 100] },
      },
    },
  },
});

export const CameraFollow = defineComponent({
  name: 'CameraFollow',
  category: 'Rendering',
  requires: ['Transform'],
  description: 'Smoothly moves this entity toward a target entity. Put it on the camera.',
  schema: {
    target: { type: 'entity', description: 'Scene id of the entity to follow' },
    offset: { type: 'vec2', default: [0, 0] },
    /** Time for the remaining distance to halve. 0 snaps instantly. */
    halfLife: { type: 'number', default: 0.12, min: 0, description: 'Smoothing half-life in seconds' },
    lockX: { type: 'boolean', default: false },
    lockY: { type: 'boolean', default: false },
    /** Target may move within this box before the camera reacts at all. */
    deadZone: { type: 'vec2', default: [0, 0], description: 'Half-extents of the no-move zone' },
  },
});

export const TilemapRenderer = defineComponent({
  name: 'TilemapRenderer',
  category: 'Rendering',
  requires: ['Transform'],
  description:
    'Draws a grid of tiles from a tileset texture. `data` is row-major with row 0 at the ' +
    'BOTTOM, matching the +y-up axis convention. Tile index 0 means empty.',
  schema: {
    texture: { type: 'asset', assetType: 'texture' },
    width: { type: 'int', default: 0, min: 0, description: 'Columns' },
    height: { type: 'int', default: 0, min: 0, description: 'Rows' },
    tileSize: { type: 'vec2', default: [1, 1], description: 'World-unit size of one tile' },
    tilesetColumns: { type: 'int', default: 1, min: 1, description: 'Columns in the tileset image' },
    tilesetTileSize: {
      type: 'vec2',
      default: [16, 16],
      description: 'Size of one tile in the tileset image, in pixels',
    },
    data: { type: 'array', items: { type: 'int' }, default: [], description: '1-based tile ids, 0 = empty' },
    color: { type: 'color', default: '#ffffff' },
    layer: { type: 'int', default: -10 },
    order: { type: 'int', default: 0 },
    visible: { type: 'boolean', default: true },
    /** Per-tile solidity for the collision baker; empty means "every non-zero tile is solid". */
    solidTiles: { type: 'array', items: { type: 'int' }, default: [] },
  },
});

export const ParticleEmitter = defineComponent({
  name: 'ParticleEmitter',
  category: 'Rendering',
  requires: ['Transform'],
  description:
    'A CPU particle emitter. Particles are simulated in the emitter\'s world space and ' +
    'drawn as colored quads. Deterministic: it draws from the world\'s seeded RNG.',
  schema: {
    enabled: { type: 'boolean', default: true },
    rate: { type: 'number', default: 20, min: 0, description: 'Particles per second' },
    burst: { type: 'int', default: 0, min: 0, description: 'Particles emitted immediately on start' },
    maxParticles: { type: 'int', default: 200, min: 1 },
    lifetime: { type: 'vec2', default: [0.5, 1.0], description: '[min, max] seconds' },
    speed: { type: 'vec2', default: [1, 3], description: '[min, max] world units/second' },
    direction: { type: 'number', default: 90, description: 'Emission direction in degrees' },
    spread: { type: 'number', default: 360, description: 'Cone width in degrees' },
    startSize: { type: 'vec2', default: [0.1, 0.2], description: '[min, max] world units' },
    endSize: { type: 'number', default: 0, min: 0 },
    startColor: { type: 'color', default: '#ffffff' },
    endColor: { type: 'color', default: '#ffffff00' },
    gravity: { type: 'vec2', default: [0, 0] },
    drag: { type: 'number', default: 0, min: 0 },
    texture: { type: 'asset', assetType: 'texture' },
    layer: { type: 'int', default: 5 },
    /** Live particle array, owned by ParticleSystem. */
    particles: { type: 'any' },
    emitAccumulator: { type: 'any' },
  },
  onAdd(data) {
    data.particles = [];
    data.emitAccumulator = 0;
  },
});
