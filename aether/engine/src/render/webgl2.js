/**
 * WebGL2 backend — a batched sprite renderer.
 *
 * Quads are transformed on the CPU and appended to one interleaved vertex
 * buffer. A flush happens only when the texture changes or the buffer fills, so
 * a scene with a thousand sprites from one atlas costs one draw call. That is
 * the whole trick, and it is the difference between a tilemap that runs at
 * 60fps and one that does not.
 *
 * Vertex layout, 20 bytes per vertex:
 *   position  2 x float32  (world space)
 *   uv        2 x float32
 *   color     4 x uint8 normalized
 *
 * Text is rasterized to a cached offscreen canvas and drawn as a textured quad.
 * Glyph atlases would be faster, but text in a 2D game is usually a HUD with a
 * handful of strings, and the cache makes repeat draws free.
 */

import { Renderer, worldToScreen } from './renderer.js';
import * as Mat3 from '../math/mat3.js';
import * as Color from '../math/color.js';

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
in vec2 aTexCoord;
in vec4 aColor;

uniform mat3 uProjection;

out vec2 vTexCoord;
out vec4 vColor;

void main() {
  vec3 clip = uProjection * vec3(aPosition, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  vTexCoord = aTexCoord;
  vColor = aColor;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

in vec2 vTexCoord;
in vec4 vColor;

uniform sampler2D uTexture;
uniform float uUseTexture;

out vec4 fragColor;

void main() {
  vec4 texel = mix(vec4(1.0), texture(uTexture, vTexCoord), uUseTexture);
  vec4 result = texel * vColor;
  if (result.a < 0.003) discard;
  fragColor = result;
}`;

const FLOATS_PER_VERTEX = 5; // 2 pos + 2 uv + 1 packed color
const VERTICES_PER_QUAD = 4;
const INDICES_PER_QUAD = 6;

export class WebGL2Renderer extends Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [options]
   * @param {number} [options.maxQuads=4096] batch capacity before an automatic flush
   */
  constructor(canvas, options = {}) {
    super(options);
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: options.alpha ?? false,
      antialias: options.antialias ?? false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    });
    if (!gl) throw new Error('WebGL2Renderer: WebGL2 is not available on this canvas');
    this.gl = gl;

    this.capabilities = {
      textures: true,
      text: true,
      lines: true,
      polygons: true,
      readPixels: true,
    };

    this.maxQuads = options.maxQuads ?? 4096;
    this.pixelRatio = options.pixelRatio ?? (globalThis.devicePixelRatio || 1);

    this.program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.uniforms = {
      projection: gl.getUniformLocation(this.program, 'uProjection'),
      texture: gl.getUniformLocation(this.program, 'uTexture'),
      useTexture: gl.getUniformLocation(this.program, 'uUseTexture'),
    };

    this.setupBuffers();

    /** @type {Map<string, {texture: WebGLTexture, width: number, height: number, frames: Map}>} */
    this.textures = new Map();
    this.whiteTexture = createWhiteTexture(gl);
    this.textCache = new Map();
    this.maxTextCache = options.maxTextCache ?? 128;

    this.projection = Mat3.create();
    this.view = null;
    this.currentTexture = null;
    this.quadCount = 0;

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);

    this.resize(canvas.width, canvas.height);
  }

  setupBuffers() {
    const gl = this.gl;
    const maxVertices = this.maxQuads * VERTICES_PER_QUAD;

    this.vertexData = new Float32Array(maxVertices * FLOATS_PER_VERTEX);
    this.colorView = new Uint32Array(this.vertexData.buffer);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertexData.byteLength, gl.DYNAMIC_DRAW);

    const stride = FLOATS_PER_VERTEX * 4;
    const posLoc = gl.getAttribLocation(this.program, 'aPosition');
    const uvLoc = gl.getAttribLocation(this.program, 'aTexCoord');
    const colorLoc = gl.getAttribLocation(this.program, 'aColor');

    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 4, gl.UNSIGNED_BYTE, true, stride, 16);

    // The index pattern for quads never changes, so it is uploaded once.
    const indices = new Uint16Array(this.maxQuads * INDICES_PER_QUAD);
    for (let i = 0, v = 0; i < indices.length; i += INDICES_PER_QUAD, v += VERTICES_PER_QUAD) {
      indices[i] = v;
      indices[i + 1] = v + 1;
      indices[i + 2] = v + 2;
      indices[i + 3] = v;
      indices[i + 4] = v + 2;
      indices[i + 5] = v + 3;
    }
    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
  }

  resize(width, height) {
    super.resize(width, height);
    const dpr = this.pixelRatio;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    if (this.canvas.style) {
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
  }

  /**
   * @param {string} id
   * @param {TexImageSource} image
   * @param {Record<string, {x,y,w,h}>} [frames]
   */
  uploadTexture(id, image, frames) {
    const gl = this.gl;
    const existing = this.textures.get(id);
    const texture = existing?.texture ?? gl.createTexture();

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    // NEAREST by default: pixel art is the common case, and bilinear filtering
    // on a tight atlas bleeds neighbouring tiles into every sprite edge.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.textures.set(id, {
      texture,
      width: image.width ?? 1,
      height: image.height ?? 1,
      frames: frames ? new Map(Object.entries(frames)) : new Map(),
    });
  }

  begin(view) {
    const gl = this.gl;
    this.view = view;
    const dpr = this.pixelRatio;

    const vx = Math.round(view.pixelX * dpr);
    // GL's viewport origin is bottom-left; the view rect is expressed top-left.
    const vy = Math.round(this.canvas.height - (view.pixelY + view.pixelHeight) * dpr);
    const vw = Math.round(view.pixelWidth * dpr);
    const vh = Math.round(view.pixelHeight * dpr);

    gl.viewport(vx, vy, vw, vh);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(vx, vy, vw, vh);

    // `view.clear === false` leaves the framebuffer alone. An overlay pass
    // needs this: `glClear` *overwrites* the target, it does not blend, so
    // clearing to transparent black would erase whatever was drawn before it
    // rather than compositing on top.
    if (view.clear !== false) {
      const bg = view.background;
      gl.clearColor(bg.r, bg.g, bg.b, bg.a);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    Mat3.ortho(
      this.projection,
      view.x - view.halfWidth,
      view.x + view.halfWidth,
      view.y - view.halfHeight,
      view.y + view.halfHeight,
    );

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix3fv(this.uniforms.projection, false, this.projection);
    gl.uniform1i(this.uniforms.texture, 0);

    this.quadCount = 0;
    this.currentTexture = null;
    this.stats.drawCalls = 0;
    this.stats.sprites = 0;
    this.stats.batches = 0;
  }

  submit(command) {
    switch (command.type) {
      case 'sprite':
      case 'rect':
        this.pushQuadCommand(command);
        break;
      case 'circle':
        this.pushCircle(command);
        break;
      case 'line':
        this.pushLine(command);
        break;
      case 'polygon':
        this.pushPolygon(command);
        break;
      case 'text':
        this.pushText(command);
        break;
      default:
        break;
    }
  }

  end() {
    this.flush();
    this.gl.disable(this.gl.SCISSOR_TEST);
    this.gl.bindVertexArray(null);
    this.view = null;
  }

  /** Upload and draw whatever is in the batch, then reset it. */
  flush() {
    if (this.quadCount === 0) return;
    const gl = this.gl;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    const floats = this.quadCount * VERTICES_PER_QUAD * FLOATS_PER_VERTEX;
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertexData, 0, floats);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.currentTexture ?? this.whiteTexture);
    gl.uniform1f(this.uniforms.useTexture, this.currentTexture ? 1 : 0);

    gl.drawElements(gl.TRIANGLES, this.quadCount * INDICES_PER_QUAD, gl.UNSIGNED_SHORT, 0);

    this.stats.drawCalls++;
    this.stats.batches++;
    this.quadCount = 0;
  }

  /** Switch the bound texture, flushing the current batch if it differs. */
  useTexture(texture) {
    if (this.currentTexture !== texture) {
      this.flush();
      this.currentTexture = texture;
    }
  }

  /**
   * Append one transformed quad.
   * Corners are supplied in world space, already rotated and scaled.
   */
  pushQuad(x0, y0, x1, y1, x2, y2, x3, y3, u0, v0, u1, v1, packedColor) {
    if (this.quadCount >= this.maxQuads) this.flush();

    const data = this.vertexData;
    const colors = this.colorView;
    let i = this.quadCount * VERTICES_PER_QUAD * FLOATS_PER_VERTEX;

    data[i] = x0; data[i + 1] = y0; data[i + 2] = u0; data[i + 3] = v1; colors[i + 4] = packedColor;
    i += FLOATS_PER_VERTEX;
    data[i] = x1; data[i + 1] = y1; data[i + 2] = u1; data[i + 3] = v1; colors[i + 4] = packedColor;
    i += FLOATS_PER_VERTEX;
    data[i] = x2; data[i + 1] = y2; data[i + 2] = u1; data[i + 3] = v0; colors[i + 4] = packedColor;
    i += FLOATS_PER_VERTEX;
    data[i] = x3; data[i + 1] = y3; data[i + 2] = u0; data[i + 3] = v0; colors[i + 4] = packedColor;

    this.quadCount++;
  }

  pushQuadCommand(command) {
    const entry = command.texture ? this.textures.get(command.texture) : null;
    this.useTexture(entry?.texture ?? null);

    let u0 = 0;
    let v0 = 0;
    let u1 = 1;
    let v1 = 1;
    if (entry) {
      // An explicit pixel `region` wins over a named atlas `frame` — that is how
      // the tilemap addresses its tileset without any atlas metadata.
      const region = command.region ?? (command.frame ? entry.frames.get(command.frame) : null);
      if (region) {
        u0 = region.x / entry.width;
        v0 = region.y / entry.height;
        u1 = (region.x + region.w) / entry.width;
        v1 = (region.y + region.h) / entry.height;
      }
    }
    if (command.flipX) {
      const t = u0;
      u0 = u1;
      u1 = t;
    }
    if (command.flipY) {
      const t = v0;
      v0 = v1;
      v1 = t;
    }

    const w = command.width;
    const h = command.height;
    const ax = command.anchorX * w;
    const ay = command.anchorY * h;

    // Local-space corners relative to the anchor, then rotated into world space.
    const lx0 = -ax;
    const ly0 = -ay;
    const lx1 = w - ax;
    const ly1 = h - ay;

    const rad = (command.rotation ?? 0) * (Math.PI / 180);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = command.x;
    const cy = command.y;

    const packed = packColor(command.color, command.opacity ?? 1);

    this.pushQuad(
      cx + lx0 * cos - ly0 * sin, cy + lx0 * sin + ly0 * cos,
      cx + lx1 * cos - ly0 * sin, cy + lx1 * sin + ly0 * cos,
      cx + lx1 * cos - ly1 * sin, cy + lx1 * sin + ly1 * cos,
      cx + lx0 * cos - ly1 * sin, cy + lx0 * sin + ly1 * cos,
      u0, v0, u1, v1,
      packed,
    );
    this.stats.sprites++;
  }

  /** Circles are approximated with a triangle fan built from quads. */
  pushCircle(command) {
    this.useTexture(null);
    const r = command.width / 2;
    const segments = Math.max(8, Math.min(64, Math.ceil(r * 24)));
    const packed = packColor(command.color, command.opacity ?? 1);
    const cx = command.x;
    const cy = command.y;

    if (command.filled) {
      for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        this.pushQuad(
          cx, cy,
          cx + Math.cos(a0) * r, cy + Math.sin(a0) * r,
          cx + Math.cos(a1) * r, cy + Math.sin(a1) * r,
          cx, cy,
          0, 0, 1, 1,
          packed,
        );
      }
    } else {
      const half = command.thickness / 2;
      for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        this.pushQuad(
          cx + Math.cos(a0) * (r - half), cy + Math.sin(a0) * (r - half),
          cx + Math.cos(a0) * (r + half), cy + Math.sin(a0) * (r + half),
          cx + Math.cos(a1) * (r + half), cy + Math.sin(a1) * (r + half),
          cx + Math.cos(a1) * (r - half), cy + Math.sin(a1) * (r - half),
          0, 0, 1, 1,
          packed,
        );
      }
    }
  }

  /** Each segment becomes a quad expanded along its normal. */
  pushLine(command) {
    if (!command.points || command.points.length < 2) return;
    this.useTexture(null);
    const packed = packColor(command.color, command.opacity ?? 1);
    const half = Math.max(command.thickness, 0.001) / 2;

    for (let i = 0; i < command.points.length - 1; i++) {
      const p0 = command.points[i];
      const p1 = command.points[i + 1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      const nx = (-dy / len) * half;
      const ny = (dx / len) * half;
      this.pushQuad(
        p0.x + nx, p0.y + ny,
        p1.x + nx, p1.y + ny,
        p1.x - nx, p1.y - ny,
        p0.x - nx, p0.y - ny,
        0, 0, 1, 1,
        packed,
      );
    }
  }

  /** Convex polygons only — fanned from the first vertex. */
  pushPolygon(command) {
    if (!command.points || command.points.length < 3) return;
    this.useTexture(null);
    const packed = packColor(command.color, command.opacity ?? 1);
    const p = command.points;
    for (let i = 1; i < p.length - 1; i++) {
      this.pushQuad(
        p[0].x, p[0].y,
        p[i].x, p[i].y,
        p[i + 1].x, p[i + 1].y,
        p[0].x, p[0].y,
        0, 0, 1, 1,
        packed,
      );
    }
  }

  /**
   * Rasterize a string to a cached canvas texture and draw it as a quad.
   * The cache key includes everything that affects the pixels, so a HUD that
   * redraws the same score every frame uploads nothing after the first.
   */
  pushText(command) {
    const key = `${command.text}|${command.font}|${command.bold}|${command.italic}`;
    let entry = this.textCache.get(key);

    if (!entry) {
      entry = rasterizeText(this.gl, command);
      if (!entry) return;
      if (this.textCache.size >= this.maxTextCache) {
        const oldest = this.textCache.keys().next().value;
        const old = this.textCache.get(oldest);
        this.gl.deleteTexture(old.texture);
        this.textCache.delete(oldest);
      }
      this.textCache.set(key, entry);
    }

    this.useTexture(entry.texture);

    // Screen-space text is authored entirely in CSS pixels — position *and*
    // size. Everything still goes through the world projection, so both have to
    // be converted; converting only the position leaves a HUD label drawn tens
    // of world units tall, filling the screen.
    const ppu = this.view?.pixelsPerUnit ?? 1;
    const height = command.screenSpace ? (command.size * 1.4) / ppu : command.size * 1.4;
    const width = height * (entry.width / entry.height);
    const anchorX = command.align === 'left' ? 0 : command.align === 'right' ? 1 : 0.5;
    const anchorY = command.baseline === 'bottom' ? 0 : command.baseline === 'top' ? 1 : 0.5;

    let x = command.x;
    let y = command.y;
    if (command.screenSpace && this.view) {
      x = this.view.x - this.view.halfWidth + command.x / ppu;
      y = this.view.y + this.view.halfHeight - command.y / ppu;
    }

    // The quad is built inline rather than via `pushQuadCommand`, which would
    // rebind the texture by asset id — and the text texture has no asset id.
    const lx0 = -anchorX * width;
    const ly0 = -anchorY * height;
    const lx1 = width + lx0;
    const ly1 = height + ly0;

    const rad = (command.rotation ?? 0) * (Math.PI / 180);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const packed = packColor(command.color, command.opacity ?? 1);

    this.pushQuad(
      x + lx0 * cos - ly0 * sin, y + lx0 * sin + ly0 * cos,
      x + lx1 * cos - ly0 * sin, y + lx1 * sin + ly0 * cos,
      x + lx1 * cos - ly1 * sin, y + lx1 * sin + ly1 * cos,
      x + lx0 * cos - ly1 * sin, y + lx0 * sin + ly1 * cos,
      0, 0, 1, 1,
      packed,
    );
  }

  readPixels() {
    const gl = this.gl;
    const pixels = new Uint8Array(this.canvas.width * this.canvas.height * 4);
    gl.readPixels(0, 0, this.canvas.width, this.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return { width: this.canvas.width, height: this.canvas.height, pixels };
  }

  destroy() {
    const gl = this.gl;
    for (const entry of this.textures.values()) gl.deleteTexture(entry.texture);
    for (const entry of this.textCache.values()) gl.deleteTexture(entry.texture);
    gl.deleteTexture(this.whiteTexture);
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteBuffer(this.indexBuffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
    this.textures.clear();
    this.textCache.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function packColor(color, opacity) {
  const c = color ?? Color.WHITE;
  const r = clamp255(c.r * 255);
  const g = clamp255(c.g * 255);
  const b = clamp255(c.b * 255);
  const a = clamp255(c.a * opacity * 255);
  // Little-endian byte order, so the components land as RGBA in the shader.
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`WebGL2Renderer: shader link failed:\n${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    throw new Error(`WebGL2Renderer: ${kind} shader failed to compile:\n${log}`);
  }
  return shader;
}

/** A 1x1 white texture, so untextured quads take the same shader path. */
function createWhiteTexture(gl) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return texture;
}

function rasterizeText(gl, command) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const fontPx = 64; // Rasterize large; the quad scales it down cleanly.
  const font =
    `${command.italic ? 'italic ' : ''}${command.bold ? 'bold ' : ''}${fontPx}px ${command.font}`;

  ctx.font = font;
  const metrics = ctx.measureText(command.text);
  const width = Math.max(1, Math.ceil(metrics.width) + 8);
  const height = Math.ceil(fontPx * 1.4);

  canvas.width = width;
  canvas.height = height;

  ctx.font = font;
  ctx.fillStyle = '#ffffff'; // White, so the vertex color tints it.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(command.text, 4, height / 2);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return { texture, width, height };
}

/** Feature check callers can use before constructing the renderer. */
export function isWebGL2Available() {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}
