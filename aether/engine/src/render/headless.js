/**
 * The headless renderer — a recorder, not a rasterizer.
 *
 * This backend is the reason the engine can be tested and driven by an agent.
 * It accepts the same draw commands as the real backends and keeps them in a
 * list, so a test can ask questions that would otherwise require reading pixels:
 *
 *   const frame = renderer.lastFrame;
 *   assert.equal(frame.commands.length, 12);
 *   assert.ok(frame.find({ entityName: 'Player' }).x > 3);
 *
 * It also produces an ASCII rendering of the frame. That sounds like a novelty
 * and is genuinely useful: a 40x20 character grid of the scene fits in a
 * terminal, diffs cleanly between frames, and answers "is the player standing
 * on the platform" instantly — for a human reading test output or a model
 * reading a tool result.
 */

import { Renderer } from './renderer.js';

export class HeadlessRenderer extends Renderer {
  constructor(options = {}) {
    super(options);
    this.capabilities = {
      textures: true,
      text: true,
      lines: true,
      polygons: true,
      readPixels: false,
    };
    /** Frames retained for inspection. Older frames are dropped. */
    this.history = [];
    this.maxHistory = options.maxHistory ?? 8;
    this.currentFrame = null;
    /** @type {Frame|null} */
    this.lastFrame = null;
    this.frameCount = 0;
    this.textures = new Map();
  }

  uploadTexture(id, image) {
    this.textures.set(id, { id, width: image?.width ?? 0, height: image?.height ?? 0 });
  }

  uploadMesh() {
    // Nothing to upload; meshes are referenced by name in the recorded commands.
  }

  /**
   * Open the recorded frame if it is not already open.
   *
   * A rendered frame can contain several passes — the 3D world, the 2D HUD
   * over it, the debug overlay on top of that — and they all belong to *one*
   * frame. Closing on `end()` would record three, and `lastFrame` would hold
   * whichever ran last rather than what the player saw.
   */
  openFrame(view) {
    if (!this.currentFrame) {
      this.currentFrame = new Frame(this.frameCount, view);
      this.stats.drawCalls = 0;
      this.stats.sprites = 0;
      this.stats.meshes = 0;
    }
    return this.currentFrame;
  }

  begin(view) {
    const frame = this.openFrame(view);
    frame.view2d = view;
    // A 3D frame keeps its 3D view as the primary one, since that is what the
    // ASCII projection needs.
    if (!frame.view3d) frame.view = view;
  }

  submit(command) {
    if (!this.currentFrame) return;
    this.currentFrame.commands.push(command);
    this.stats.drawCalls++;
    if (command.type === 'sprite') this.stats.sprites++;
  }

  /** Ends a pass, not the frame. `finishFrame` closes it. */
  end() {}

  // -------------------------------------------------------------------------
  // 3D pass
  // -------------------------------------------------------------------------

  /** @param {object} view3d from `computeView3D` */
  begin3D(view3d, lights = [], skybox = null) {
    const frame = this.openFrame(view3d);
    frame.view = view3d;
    frame.view3d = view3d;
    frame.lights = lights;
    frame.skybox = skybox;
  }

  submitMesh(command) {
    if (!this.currentFrame) return;
    this.currentFrame.commands.push(command);
    this.stats.drawCalls++;
    this.stats.meshes++;
  }

  end3D() {}

  /** Close the frame and publish it as `lastFrame`. Called once per frame. */
  finishFrame() {
    if (!this.currentFrame) return;
    this.frameCount++;
    this.lastFrame = this.currentFrame;
    this.history.push(this.currentFrame);
    while (this.history.length > this.maxHistory) this.history.shift();
    this.currentFrame = null;
  }

  /** Drop recorded frames. */
  clear() {
    this.history.length = 0;
    this.lastFrame = null;
    this.frameCount = 0;
  }
}

/** One recorded frame's worth of draw commands. */
export class Frame {
  constructor(index, view) {
    this.index = index;
    this.view = view;
    /** @type {import('./renderer.js').DrawCommand[]} */
    this.commands = [];
  }

  get count() {
    return this.commands.length;
  }

  /**
   * Find the first command matching every key in `query`.
   * @example frame.find({ entityName: 'Player' })
   * @example frame.find({ type: 'text' })
   */
  find(query) {
    return this.commands.find((c) => matches(c, query)) ?? null;
  }

  /** All commands matching `query`. */
  findAll(query) {
    return this.commands.filter((c) => matches(c, query));
  }

  /** @returns {boolean} */
  has(query) {
    return this.find(query) !== null;
  }

  /** Commands grouped by type, for a quick "what got drawn" summary. */
  summary() {
    const byType = {};
    for (const c of this.commands) byType[c.type] = (byType[c.type] ?? 0) + 1;
    return { frame: this.index, total: this.commands.length, byType };
  }

  /**
   * Render the frame as an ASCII grid.
   *
   * Each drawn entity gets a character: the first letter of its name, or a
   * shape-specific glyph. Overlaps resolve in draw order, so what you see is
   * what would be on top.
   *
   * @param {object} [options]
   * @param {number} [options.width=48]  columns
   * @param {number} [options.height=24] rows
   * @param {boolean} [options.border=true]
   */
  toAscii(options = {}) {
    const cols = options.width ?? 48;
    const rows = options.height ?? 24;
    const view = this.view;
    if (!view) return '(no camera)';

    // A 3D frame has to be projected through the camera; a 2D one is a direct
    // world-to-cell mapping.
    if (this.view3d) return this.toAscii3D(options);

    const grid = Array.from({ length: rows }, () => new Array(cols).fill(' '));

    const worldToCell = (wx, wy) => {
      const nx = (wx - (view.x - view.halfWidth)) / (view.halfWidth * 2);
      const ny = (wy - (view.y - view.halfHeight)) / (view.halfHeight * 2);
      return {
        col: Math.round(nx * (cols - 1)),
        // Row 0 is the top of the output, but +y is up in the world.
        row: Math.round((1 - ny) * (rows - 1)),
      };
    };

    for (const c of this.commands) {
      const glyph = glyphFor(c);
      const w = c.width ?? c.size?.x ?? 0.4;
      const h = c.height ?? c.size?.y ?? 0.4;
      const a = worldToCell(c.x - w / 2, c.y - h / 2);
      const b = worldToCell(c.x + w / 2, c.y + h / 2);

      const c0 = Math.max(0, Math.min(a.col, b.col));
      const c1 = Math.min(cols - 1, Math.max(a.col, b.col));
      const r0 = Math.max(0, Math.min(a.row, b.row));
      const r1 = Math.min(rows - 1, Math.max(a.row, b.row));

      for (let r = r0; r <= r1; r++) {
        for (let col = c0; col <= c1; col++) grid[r][col] = glyph;
      }
    }

    const body = grid.map((row) => row.join(''));
    if (options.border === false) return body.join('\n');
    const bar = `+${'-'.repeat(cols)}+`;
    return [bar, ...body.map((r) => `|${r}|`), bar].join('\n');
  }

  /**
   * Render a 3D frame as an ASCII grid, projected through the camera.
   *
   * Each mesh is projected to normalized device coordinates and painted as a
   * rectangle sized by its bounding sphere, nearest last so occlusion reads
   * correctly. It is a crude renderer, and it answers the question that
   * actually matters in a headless run — "is the player on the platform, is the
   * door in front of me" — in a form that fits in a terminal and diffs cleanly
   * between frames.
   */
  toAscii3D(options = {}) {
    const cols = options.width ?? 56;
    const rows = options.height ?? 24;
    const view = this.view3d;
    if (!view) return '(no 3D camera)';

    const grid = Array.from({ length: rows }, () => new Array(cols).fill(' '));
    // A real depth buffer, not a painter's sort.
    //
    // Sorting whole objects by their center depth cannot work here: a 20x1x20
    // floor spans the entire depth range, so *any* single depth for it is wrong
    // and it either covers everything or is covered by everything. Depth per
    // cell is a few more lines and simply correct.
    const depth = Array.from({ length: rows }, () => new Array(cols).fill(Infinity));

    const toCol = (ndcX) => Math.round(((ndcX + 1) / 2) * (cols - 1));
    // NDC y is up; row 0 is the top of the output.
    const toRow = (ndcY) => Math.round(((1 - ndcY) / 2) * (rows - 1));

    for (const command of this.commands) {
      if (command.type !== 'mesh') continue;

      // Project all eight corners of the object's box. Using an isotropic
      // radius instead would draw a 20x1x20 floor as a 14-unit cube.
      const half = command.halfExtents ?? {
        x: command.radius ?? 0.5,
        y: command.radius ?? 0.5,
        z: command.radius ?? 0.5,
      };

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let zAtMinY = 0;
      let zAtMaxY = 0;
      let visible = false;
      let clipped = false;

      for (let corner = 0; corner < 8; corner++) {
        const projected = projectNDC(
          view.viewProjection,
          command.x + (corner & 1 ? half.x : -half.x),
          command.y + (corner & 2 ? half.y : -half.y),
          command.z + (corner & 4 ? half.z : -half.z),
        );
        // A corner behind the camera cannot be projected.
        if (!projected) {
          clipped = true;
          continue;
        }
        if (!visible) {
          minX = maxX = projected.x;
          minY = maxY = projected.y;
          zAtMinY = zAtMaxY = projected.z;
          visible = true;
          continue;
        }
        if (projected.x < minX) minX = projected.x;
        if (projected.x > maxX) maxX = projected.x;
        if (projected.y < minY) {
          minY = projected.y;
          zAtMinY = projected.z;
        }
        if (projected.y > maxY) {
          maxY = projected.y;
          zAtMaxY = projected.z;
        }
      }
      if (!visible) continue;

      if (clipped) {
        // The object straddles the near plane — a large floor the camera is
        // standing on, or a wall you have walked into. Projecting only its
        // visible corners would shrink it to the sliver near the horizon and
        // leave the foreground blank, which is exactly backwards.
        //
        // Extend the rect to the screen edges on the side the object lies, and
        // mark that edge as nearest so it wins the depth test there.
        minX = Math.min(minX, -1);
        maxX = Math.max(maxX, 1);
        if (command.y < view.position.y) {
          minY = -1;
          zAtMinY = -1;
        } else {
          maxY = 1;
          zAtMaxY = -1;
        }
      }

      const c0 = Math.max(0, toCol(minX));
      const c1 = Math.min(cols - 1, toCol(maxX));
      const r0 = Math.max(0, toRow(maxY));
      const r1 = Math.min(rows - 1, toRow(minY));
      if (c1 < c0 || r1 < r0) continue;

      const glyph = glyphFor(command);
      const spanY = maxY - minY;

      for (let r = r0; r <= r1; r++) {
        // Interpolate depth down the object's screen rect. For a floor viewed
        // at an angle this is the difference between a flat gray wall and a
        // surface things can stand on.
        const ndcY = 1 - (r / (rows - 1)) * 2;
        const t = spanY > 1e-9 ? (maxY - ndcY) / spanY : 0;
        const cellDepth = zAtMaxY + (zAtMinY - zAtMaxY) * Math.min(1, Math.max(0, t));

        for (let c = c0; c <= c1; c++) {
          if (cellDepth > depth[r][c]) continue;
          depth[r][c] = cellDepth;
          grid[r][c] = glyph;
        }
      }
    }

    const body = grid.map((row) => row.join(''));
    if (options.border === false) return body.join('\n');
    const bar = `+${'-'.repeat(cols)}+`;
    return [bar, ...body.map((r) => `|${r}|`), bar].join('\n');
  }

  /**
   * A top-down (xz) map of the 3D scene.
   *
   * Complements `toAscii3D`: the camera view answers "what can I see", this
   * answers "where is everything", which is the more useful question when a
   * level is not laying out the way you expected.
   */
  toAsciiTopDown(options = {}) {
    const cols = options.width ?? 48;
    const rows = options.height ?? 24;
    const meshes = this.commands.filter((c) => c.type === 'mesh');
    if (meshes.length === 0) return '(no meshes)';

    const extentOf = (m) => m.halfExtents ?? { x: m.radius, y: m.radius, z: m.radius };

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const m of meshes) {
      const half = extentOf(m);
      minX = Math.min(minX, m.x - half.x);
      maxX = Math.max(maxX, m.x + half.x);
      minZ = Math.min(minZ, m.z - half.z);
      maxZ = Math.max(maxZ, m.z + half.z);
    }
    const spanX = Math.max(maxX - minX, 1e-6);
    const spanZ = Math.max(maxZ - minZ, 1e-6);

    const grid = Array.from({ length: rows }, () => new Array(cols).fill(' '));
    // Taller objects win a contested cell, which keeps a floor from hiding
    // everything standing on it.
    for (const m of [...meshes].sort((a, b) => a.y - b.y)) {
      const half = extentOf(m);
      const c0 = Math.max(0, Math.round(((m.x - half.x - minX) / spanX) * (cols - 1)));
      const c1 = Math.min(cols - 1, Math.round(((m.x + half.x - minX) / spanX) * (cols - 1)));
      // +z is toward the viewer, so larger z sits lower on the map.
      const r0 = Math.max(0, Math.round(((m.z - half.z - minZ) / spanZ) * (rows - 1)));
      const r1 = Math.min(rows - 1, Math.round(((m.z + half.z - minZ) / spanZ) * (rows - 1)));
      const glyph = glyphFor(m);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) grid[r][c] = glyph;
      }
    }

    const bar = `+${'-'.repeat(cols)}+`;
    const label = `x: ${minX.toFixed(1)}..${maxX.toFixed(1)}  z: ${minZ.toFixed(1)}..${maxZ.toFixed(1)}`;
    return [bar, ...grid.map((r) => `|${r.join('')}|`), bar, label].join('\n');
  }

  /** A compact, diff-friendly serialization of the frame. */
  toJSON() {
    return {
      frame: this.index,
      camera: this.view
        ? { x: round(this.view.x), y: round(this.view.y), size: round(this.view.size) }
        : null,
      commands: this.commands.map((c) => ({
        type: c.type,
        entity: c.entityName,
        x: round(c.x),
        y: round(c.y),
        ...(c.z !== undefined ? { z: round(c.z) } : {}),
        ...(c.mesh ? { mesh: c.mesh } : {}),
        ...(c.text !== undefined ? { text: c.text } : {}),
        ...(c.texture ? { texture: c.texture } : {}),
        ...(c.frame ? { frameName: c.frame } : {}),
      })),
    };
  }
}

/**
 * Project a world point to normalized device coordinates.
 * @returns {{x, y, z}|null} null when the point is behind the camera
 */
function projectNDC(m, x, y, z) {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (w <= 1e-6) return null;
  return {
    x: (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    y: (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    z: (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  };
}

function matches(command, query) {
  for (const [key, value] of Object.entries(query)) {
    if (command[key] !== value) return false;
  }
  return true;
}

function glyphFor(command) {
  if (command.type === 'text') return '"';
  if (command.entityName) {
    const ch = command.entityName.trim()[0];
    if (ch) return ch;
  }
  if (command.type === 'circle') return 'o';
  if (command.type === 'line') return '/';
  return '#';
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}
