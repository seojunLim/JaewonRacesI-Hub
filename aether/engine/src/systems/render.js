/**
 * RenderSystem — turns components into draw commands.
 *
 * The system does the work every backend would otherwise duplicate: pick the
 * active camera, cull what is off screen, sort by layer, and emit plain draw
 * command objects. The backend only rasterizes.
 *
 * Because the command list is data, the headless backend can record it and a
 * test can assert on it. "Did the game draw the win banner" becomes a question
 * about an array rather than about pixels.
 */

import { Phase, Order, defineSystem } from '../core/system.js';
import { computeView, sortDrawList, isVisible } from '../render/renderer.js';
import { particleColor, particleSize } from './gameplay.js';
import * as Color from '../math/color.js';

/** Resource key for the installed renderer. */
export const RENDERER_RESOURCE = 'renderer';

/**
 * Pick the camera to render with: the active camera with the highest priority,
 * ties broken by entity id so the choice never flickers between frames.
 * @returns {{entity: *, camera: object, transform: object}|null}
 */
export function activeCamera(world) {
  let best = null;
  for (const [entity, camera] of world.each('Camera')) {
    if (!camera.active) continue;
    if (!best || camera.priority > best.camera.priority || (camera.priority === best.camera.priority && entity.id < best.entity.id)) {
      best = { entity, camera, transform: entity.get('WorldTransform') ?? entity.get('Transform') };
    }
  }
  return best;
}

export const RenderSystem = defineSystem({
  name: 'RenderSystem',
  phase: Phase.RENDER,
  order: Order.DEFAULT,
  description:
    'Builds the draw list from Sprite, ShapeRenderer, Text, TilemapRenderer and ' +
    'ParticleEmitter components, sorts it, and submits it to the active renderer.',
  reads: ['Camera', 'Sprite', 'ShapeRenderer', 'Text', 'TilemapRenderer', 'ParticleEmitter', 'WorldTransform'],
  update({ world }) {
    const renderer = world.getResource(RENDERER_RESOURCE);
    if (!renderer) return;

    const cam = activeCamera(world);
    if (!cam) return;

    const view = computeView(cam.camera, cam.transform, renderer.width, renderer.height);
    const drawList = buildDrawList(world, view);

    renderer.begin(view);
    for (const command of drawList) renderer.submit(command);
    renderer.end();
  },
});

/**
 * Build and sort the frame's draw commands.
 *
 * Exported because it is useful on its own: the editor calls it to hit-test the
 * mouse against what is actually visible, and tests call it to inspect a frame
 * without installing a renderer at all.
 *
 * @returns {import('../render/renderer.js').DrawCommand[]}
 */
export function buildDrawList(world, view) {
  const list = [];
  let seq = 0;

  const push = (command) => {
    command.seq = seq++;
    list.push(command);
  };

  for (const [entity, sprite, wt] of world.each('Sprite', 'WorldTransform')) {
    if (!sprite.visible || sprite.opacity <= 0) continue;
    const width = sprite.size.x * Math.abs(wt.scaleX);
    const height = sprite.size.y * Math.abs(wt.scaleY);
    // Cull with the diagonal as the radius so a rotated sprite is never clipped
    // early at the screen edge.
    if (!isVisible(view, wt.x, wt.y, Math.hypot(width, height) / 2)) continue;

    push({
      type: 'sprite',
      entityId: entity.id,
      entityName: entity.name,
      x: wt.x,
      y: wt.y,
      rotation: wt.rotation,
      width,
      height,
      anchorX: sprite.anchor.x,
      anchorY: sprite.anchor.y,
      texture: sprite.texture,
      frame: sprite.frame,
      color: sprite.color,
      opacity: sprite.opacity,
      flipX: sprite.flipX !== (wt.scaleX < 0),
      flipY: sprite.flipY !== (wt.scaleY < 0),
      layer: sprite.layer,
      order: sprite.order,
    });
  }

  for (const [entity, shape, wt] of world.each('ShapeRenderer', 'WorldTransform')) {
    if (!shape.visible || shape.opacity <= 0) continue;
    const width = shape.size.x * Math.abs(wt.scaleX);
    const height = shape.size.y * Math.abs(wt.scaleY);

    if (shape.shape === 'line' || shape.shape === 'polygon') {
      if (!shape.points || shape.points.length < 2) continue;
      const points = shape.points.map((p) => ({
        x: wt.x + p.x * wt.scaleX,
        y: wt.y + p.y * wt.scaleY,
      }));
      push({
        type: shape.shape,
        entityId: entity.id,
        entityName: entity.name,
        x: wt.x,
        y: wt.y,
        points,
        color: shape.color,
        filled: shape.filled,
        thickness: shape.thickness,
        opacity: shape.opacity,
        layer: shape.layer,
        order: shape.order,
      });
      continue;
    }

    if (!isVisible(view, wt.x, wt.y, Math.hypot(width, height) / 2)) continue;
    push({
      type: shape.shape === 'circle' ? 'circle' : 'rect',
      entityId: entity.id,
      entityName: entity.name,
      x: wt.x,
      y: wt.y,
      rotation: wt.rotation,
      width,
      height,
      anchorX: shape.anchor.x,
      anchorY: shape.anchor.y,
      color: shape.color,
      filled: shape.filled,
      thickness: shape.thickness,
      opacity: shape.opacity,
      layer: shape.layer,
      order: shape.order,
    });
  }

  for (const [entity, tilemap, wt] of world.each('TilemapRenderer', 'WorldTransform')) {
    if (!tilemap.visible || tilemap.width === 0 || tilemap.height === 0) continue;
    emitTilemap(push, entity, tilemap, wt, view);
  }

  for (const [entity, emitter, wt] of world.each('ParticleEmitter', 'WorldTransform')) {
    for (const particle of emitter.particles) {
      const size = particleSize(emitter, particle);
      if (size <= 0) continue;
      if (!isVisible(view, particle.x, particle.y, size)) continue;
      const color = particleColor(emitter, particle);
      push({
        type: emitter.texture ? 'sprite' : 'rect',
        entityId: entity.id,
        entityName: entity.name,
        x: particle.x,
        y: particle.y,
        rotation: 0,
        width: size,
        height: size,
        anchorX: 0.5,
        anchorY: 0.5,
        texture: emitter.texture,
        frame: '',
        color,
        opacity: color.a,
        filled: true,
        thickness: 0,
        flipX: false,
        flipY: false,
        layer: emitter.layer,
        order: 0,
      });
    }
  }

  for (const [entity, text, wt] of world.each('Text', 'WorldTransform')) {
    if (!text.visible || text.opacity <= 0 || text.text === '') continue;
    push({
      type: 'text',
      entityId: entity.id,
      entityName: entity.name,
      x: wt.x,
      y: wt.y,
      rotation: text.screenSpace ? 0 : wt.rotation,
      text: text.text,
      font: text.font,
      size: text.size,
      color: text.color,
      align: text.align,
      baseline: text.baseline,
      bold: text.bold,
      italic: text.italic,
      opacity: text.opacity,
      screenSpace: text.screenSpace,
      layer: text.layer,
      order: text.order,
    });
  }

  return sortDrawList(list);
}

/**
 * Emit one quad per visible tile.
 *
 * Only the tiles inside the view are emitted, which is what makes a large
 * tilemap affordable: a 500x500 map is 250,000 tiles, but a screen holds maybe
 * 400 of them, and the loop below only ever touches those.
 */
function emitTilemap(push, entity, tilemap, wt, view) {
  const tw = tilemap.tileSize.x * Math.abs(wt.scaleX);
  const th = tilemap.tileSize.y * Math.abs(wt.scaleY);
  if (tw <= 0 || th <= 0) return;

  const originX = wt.x;
  const originY = wt.y;

  const minCol = Math.max(0, Math.floor((view.x - view.halfWidth - originX) / tw) - 1);
  const maxCol = Math.min(tilemap.width - 1, Math.ceil((view.x + view.halfWidth - originX) / tw));
  const minRow = Math.max(0, Math.floor((view.y - view.halfHeight - originY) / th) - 1);
  const maxRow = Math.min(tilemap.height - 1, Math.ceil((view.y + view.halfHeight - originY) / th));

  const columns = tilemap.tilesetColumns;
  const tsx = tilemap.tilesetTileSize.x;
  const tsy = tilemap.tilesetTileSize.y;

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const tile = tilemap.data[row * tilemap.width + col];
      if (!tile) continue;
      const index = tile - 1;
      push({
        type: tilemap.texture ? 'sprite' : 'rect',
        entityId: entity.id,
        entityName: entity.name,
        x: originX + col * tw,
        y: originY + row * th,
        rotation: 0,
        width: tw,
        height: th,
        anchorX: 0,
        anchorY: 0,
        texture: tilemap.texture,
        frame: '',
        // The tile's pixel rect in the tileset image. Backends prefer `region`
        // over `frame` when it is present, so a tilemap needs no atlas metadata.
        region: tilemap.texture
          ? { x: (index % columns) * tsx, y: Math.floor(index / columns) * tsy, w: tsx, h: tsy }
          : null,
        tileIndex: index,
        color: tilemap.color,
        opacity: 1,
        filled: true,
        thickness: 0,
        flipX: false,
        flipY: false,
        layer: tilemap.layer,
        order: tilemap.order,
      });
    }
  }
}

/**
 * Closes the rendered frame after every pass has drawn.
 *
 * A frame can contain a 3D pass, a 2D overlay and a debug overlay; they are one
 * frame, not three. Backends that buffer a frame (the headless recorder) need a
 * single, well-defined point at which it is complete, and this is it.
 */
export const FrameEndSystem = defineSystem({
  name: 'FrameEndSystem',
  phase: Phase.POST_RENDER,
  order: Order.LATE,
  description: 'Signals the renderer that every pass for this frame has finished.',
  update({ world }) {
    world.getResource(RENDERER_RESOURCE)?.finishFrame?.();
  },
});

/**
 * Debug overlay: draws collider outlines, velocities and contact normals.
 * Off by default; the editor and `sjl dev` turn it on with a key.
 */
export const DebugDrawSystem = defineSystem({
  name: 'DebugDrawSystem',
  phase: Phase.POST_RENDER,
  order: Order.DEFAULT,
  enabled: false,
  description: 'Draws collider outlines and velocity vectors over the frame. Disabled by default.',
  reads: ['BoxCollider', 'CircleCollider', 'Rigidbody'],
  update({ world }) {
    const renderer = world.getResource(RENDERER_RESOURCE);
    if (!renderer) return;
    const cam = activeCamera(world);
    if (!cam) return;

    const view = computeView(cam.camera, cam.transform, renderer.width, renderer.height);
    const green = Color.fromAny('#3ddc84');
    const yellow = Color.fromAny('#ffd166');
    const cyan = Color.fromAny('#4cc9f0');

    renderer.begin({ ...view, background: { r: 0, g: 0, b: 0, a: 0 } });

    let seq = 0;
    for (const [entity, collider, wt] of world.each('BoxCollider', 'WorldTransform')) {
      if (!collider.enabled) continue;
      renderer.submit({
        type: 'rect',
        entityId: entity.id,
        entityName: entity.name,
        x: wt.x + collider.offset.x,
        y: wt.y + collider.offset.y,
        rotation: 0,
        width: collider.size.x * Math.abs(wt.scaleX),
        height: collider.size.y * Math.abs(wt.scaleY),
        anchorX: 0.5,
        anchorY: 0.5,
        color: collider.isTrigger ? yellow : green,
        filled: false,
        thickness: 0.04,
        opacity: 1,
        layer: 1000,
        order: seq++,
      });
    }

    for (const [entity, collider, wt] of world.each('CircleCollider', 'WorldTransform')) {
      if (!collider.enabled) continue;
      const scale = Math.max(Math.abs(wt.scaleX), Math.abs(wt.scaleY));
      renderer.submit({
        type: 'circle',
        entityId: entity.id,
        entityName: entity.name,
        x: wt.x + collider.offset.x,
        y: wt.y + collider.offset.y,
        rotation: 0,
        width: collider.radius * 2 * scale,
        height: collider.radius * 2 * scale,
        anchorX: 0.5,
        anchorY: 0.5,
        color: collider.isTrigger ? yellow : green,
        filled: false,
        thickness: 0.04,
        opacity: 1,
        layer: 1000,
        order: seq++,
      });
    }

    for (const [entity, body, wt] of world.each('Rigidbody', 'WorldTransform')) {
      if (body.velocity.x === 0 && body.velocity.y === 0) continue;
      renderer.submit({
        type: 'line',
        entityId: entity.id,
        entityName: entity.name,
        x: wt.x,
        y: wt.y,
        points: [
          { x: wt.x, y: wt.y },
          { x: wt.x + body.velocity.x * 0.15, y: wt.y + body.velocity.y * 0.15 },
        ],
        color: cyan,
        filled: false,
        thickness: 0.03,
        opacity: 1,
        layer: 1001,
        order: seq++,
      });
    }

    renderer.end();
  },
});
