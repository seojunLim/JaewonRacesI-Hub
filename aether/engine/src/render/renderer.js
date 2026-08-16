/**
 * The renderer interface and the camera math every backend shares.
 *
 * Render systems never touch a canvas or a GL context. They build a list of
 * draw commands — plain objects — and hand it to whichever backend is
 * installed. That indirection is what makes the headless backend possible, and
 * the headless backend is what lets an agent assert "the player sprite was
 * drawn at (3, 0), tinted red" without a GPU, a display, or a screenshot
 * diffing pipeline.
 *
 * @typedef {object} CameraView
 * @property {number} x            world-space center
 * @property {number} y
 * @property {number} rotation     degrees
 * @property {number} size         half-height in world units (after zoom)
 * @property {object} background   clear color
 * @property {{x:number,y:number,w:number,h:number}} viewport  normalized 0..1
 * @property {number} pixelWidth   viewport width in device pixels
 * @property {number} pixelHeight  viewport height in device pixels
 * @property {number} pixelsPerUnit
 */

/**
 * @typedef {object} DrawCommand
 * @property {'sprite'|'rect'|'circle'|'line'|'polygon'|'text'} type
 * @property {number} layer
 * @property {number} order
 * @property {number} entityId
 */

/** Base class. A backend overrides `begin`, `submit`/`draw*` and `end`. */
export class Renderer {
  constructor(options = {}) {
    this.width = options.width ?? 800;
    this.height = options.height ?? 600;
    this.pixelRatio = options.pixelRatio ?? 1;
    /** Backends set this so systems can branch on capability, not on class. */
    this.capabilities = {
      textures: false,
      text: false,
      lines: false,
      polygons: false,
      readPixels: false,
    };
    this.stats = { drawCalls: 0, sprites: 0, batches: 0 };
  }

  /** @param {number} width @param {number} height in CSS pixels */
  resize(width, height) {
    this.width = width;
    this.height = height;
  }

  /** Called once per camera, before any draw commands for that camera. */
  begin(_view) {}

  /** @param {DrawCommand} _command */
  submit(_command) {}

  /** Called after the last command for a camera. */
  end() {}

  /** Release GPU or DOM resources. */
  destroy() {}

  /** Register a loaded texture with the backend. Ignored by backends without textures. */
  uploadTexture(_id, _image) {}
}

/**
 * Compute the view parameters for a camera.
 *
 * The camera's `size` is a half-height, so the visible world height is always
 * `2 * size` no matter the window shape and the horizontal extent follows from
 * the aspect ratio. Framing a scene once therefore keeps working on a phone, an
 * ultrawide monitor, and a 400x300 headless capture.
 *
 * @param {object} camera        the Camera component
 * @param {object} transform     its WorldTransform (or Transform)
 * @param {number} surfaceWidth  in device pixels
 * @param {number} surfaceHeight
 * @returns {CameraView}
 */
export function computeView(camera, transform, surfaceWidth, surfaceHeight) {
  const viewport = camera.viewport ?? { x: 0, y: 0, w: 1, h: 1 };
  const pixelWidth = Math.max(1, Math.round(surfaceWidth * viewport.w));
  const pixelHeight = Math.max(1, Math.round(surfaceHeight * viewport.h));
  const size = camera.size / (camera.zoom || 1);

  return {
    x: transform?.x ?? transform?.position?.x ?? 0,
    y: transform?.y ?? transform?.position?.y ?? 0,
    rotation: transform?.rotation ?? 0,
    size,
    background: camera.background,
    viewport,
    pixelX: Math.round(surfaceWidth * viewport.x),
    pixelY: Math.round(surfaceHeight * viewport.y),
    pixelWidth,
    pixelHeight,
    pixelsPerUnit: pixelHeight / (size * 2),
    aspect: pixelWidth / pixelHeight,
    halfWidth: (size * pixelWidth) / pixelHeight,
    halfHeight: size,
  };
}

/** The world-space rectangle a view covers. Used for culling and for input picking. */
export function viewBounds(view) {
  return {
    x: view.x - view.halfWidth,
    y: view.y - view.halfHeight,
    w: view.halfWidth * 2,
    h: view.halfHeight * 2,
  };
}

/**
 * World point -> screen point, in CSS pixels with y down (DOM convention).
 * @returns {{x: number, y: number}}
 */
export function worldToScreen(view, wx, wy, out = { x: 0, y: 0 }) {
  out.x = view.pixelX + (wx - view.x) * view.pixelsPerUnit + view.pixelWidth / 2;
  out.y = view.pixelY + view.pixelHeight / 2 - (wy - view.y) * view.pixelsPerUnit;
  return out;
}

/** Screen point (CSS pixels, y down) -> world point. The inverse of the above. */
export function screenToWorld(view, sx, sy, out = { x: 0, y: 0 }) {
  out.x = (sx - view.pixelX - view.pixelWidth / 2) / view.pixelsPerUnit + view.x;
  out.y = view.y - (sy - view.pixelY - view.pixelHeight / 2) / view.pixelsPerUnit;
  return out;
}

/**
 * Sort draw commands into their final submission order.
 *
 * `layer` first, then `order`, then entity id. The final tiebreak on entity id
 * is what stops two sprites on the same layer from swapping z-order between
 * frames — flicker that is maddening to track down when the real cause is an
 * unstable sort.
 */
export function sortDrawList(list) {
  list.sort(
    (a, b) => a.layer - b.layer || a.order - b.order || a.entityId - b.entityId || a.seq - b.seq,
  );
  return list;
}

/** Is a world-space circle of `radius` at `(x, y)` possibly visible? */
export function isVisible(view, x, y, radius) {
  return (
    x + radius >= view.x - view.halfWidth &&
    x - radius <= view.x + view.halfWidth &&
    y + radius >= view.y - view.halfHeight &&
    y - radius <= view.y + view.halfHeight
  );
}
