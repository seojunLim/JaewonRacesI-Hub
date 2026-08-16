/**
 * Canvas2D backend.
 *
 * Slower than WebGL2 for large sprite counts, but it has no shader compilation,
 * no context-loss handling, and it renders text natively. It is the fallback
 * when WebGL2 is unavailable, and the better choice for UI-heavy or
 * low-sprite-count games.
 */

import { Renderer, worldToScreen } from './renderer.js';
import * as Color from '../math/color.js';

export class Canvas2DRenderer extends Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas, options = {}) {
    super(options);
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: options.alpha ?? false });
    if (!this.ctx) throw new Error('Canvas2DRenderer: could not acquire a 2d context');

    this.capabilities = {
      textures: true,
      text: true,
      lines: true,
      polygons: true,
      readPixels: true,
    };
    /** @type {Map<string, {image: *, frames: Map<string, {x,y,w,h}>}>} */
    this.textures = new Map();
    this.view = null;
    this.pixelRatio = options.pixelRatio ?? (globalThis.devicePixelRatio || 1);
    this.resize(canvas.width, canvas.height);
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
    // Crisp pixel art by default. A game that wants smoothing can set it back.
    this.ctx.imageSmoothingEnabled = false;
  }

  /**
   * @param {string} id
   * @param {CanvasImageSource} image
   * @param {Record<string, {x:number,y:number,w:number,h:number}>} [frames] atlas regions
   */
  uploadTexture(id, image, frames) {
    this.textures.set(id, {
      image,
      frames: frames ? new Map(Object.entries(frames)) : new Map(),
      width: image.width ?? 0,
      height: image.height ?? 0,
    });
  }

  begin(view) {
    this.view = view;
    const ctx = this.ctx;
    const dpr = this.pixelRatio;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clip to the viewport so split-screen cameras cannot draw over each other.
    if (view.viewport.w < 1 || view.viewport.h < 1) {
      ctx.beginPath();
      ctx.rect(view.pixelX, view.pixelY, view.pixelWidth, view.pixelHeight);
      ctx.clip();
    }

    ctx.fillStyle = Color.toCSS(view.background);
    ctx.fillRect(view.pixelX, view.pixelY, view.pixelWidth, view.pixelHeight);

    this.stats.drawCalls = 0;
    this.stats.sprites = 0;
  }

  submit(command) {
    switch (command.type) {
      case 'sprite':
        this.drawSprite(command);
        break;
      case 'rect':
        this.drawRect(command);
        break;
      case 'circle':
        this.drawCircle(command);
        break;
      case 'line':
        this.drawLine(command);
        break;
      case 'polygon':
        this.drawPolygon(command);
        break;
      case 'text':
        this.drawText(command);
        break;
      default:
        break;
    }
    this.stats.drawCalls++;
  }

  end() {
    this.ctx.restore();
    this.view = null;
  }

  /** Set up the canvas transform for a world-space object. */
  withTransform(command, fn) {
    const ctx = this.ctx;
    const view = this.view;
    const screen = worldToScreen(view, command.x, command.y);
    const ppu = view.pixelsPerUnit;

    ctx.save();
    ctx.globalAlpha = command.opacity ?? 1;
    ctx.translate(screen.x, screen.y);
    // Negated because canvas y grows downward while world y grows upward, so a
    // counter-clockwise world rotation is a clockwise screen rotation.
    if (command.rotation) ctx.rotate(-command.rotation * (Math.PI / 180));
    fn(ctx, ppu);
    ctx.restore();
  }

  drawSprite(command) {
    const texture = command.texture ? this.textures.get(command.texture) : null;
    this.withTransform(command, (ctx, ppu) => {
      const w = command.width * ppu;
      const h = command.height * ppu;
      const ox = -command.anchorX * w;
      // Anchor is measured from the bottom in world space; canvas measures from
      // the top, hence `1 - anchorY`.
      const oy = -(1 - command.anchorY) * h;

      const sx = command.flipX ? -1 : 1;
      const sy = command.flipY ? -1 : 1;
      if (sx !== 1 || sy !== 1) {
        ctx.scale(sx, sy);
      }
      const dx = sx === -1 ? -ox - w : ox;
      const dy = sy === -1 ? -oy - h : oy;

      if (texture) {
        // An explicit pixel `region` wins over a named atlas `frame` — that is
        // how the tilemap addresses its tileset without any atlas metadata.
        const region = command.region ?? (command.frame ? texture.frames.get(command.frame) : null);
        if (region) {
          ctx.drawImage(texture.image, region.x, region.y, region.w, region.h, dx, dy, w, h);
        } else {
          ctx.drawImage(texture.image, dx, dy, w, h);
        }
        // Tint by compositing the color over the drawn pixels. Cheap and good
        // enough; a shader-based multiply is what the WebGL backend is for.
        if (command.color && !isWhite(command.color)) {
          ctx.globalCompositeOperation = 'multiply';
          ctx.fillStyle = Color.toCSS(command.color);
          ctx.fillRect(dx, dy, w, h);
          ctx.globalCompositeOperation = 'source-over';
        }
      } else {
        ctx.fillStyle = Color.toCSS(command.color);
        ctx.fillRect(dx, dy, w, h);
      }
      this.stats.sprites++;
    });
  }

  drawRect(command) {
    this.withTransform(command, (ctx, ppu) => {
      const w = command.width * ppu;
      const h = command.height * ppu;
      const dx = -command.anchorX * w;
      const dy = -(1 - command.anchorY) * h;
      if (command.filled) {
        ctx.fillStyle = Color.toCSS(command.color);
        ctx.fillRect(dx, dy, w, h);
      } else {
        ctx.strokeStyle = Color.toCSS(command.color);
        ctx.lineWidth = Math.max(1, command.thickness * ppu);
        ctx.strokeRect(dx, dy, w, h);
      }
    });
  }

  drawCircle(command) {
    this.withTransform(command, (ctx, ppu) => {
      const r = (command.width / 2) * ppu;
      ctx.beginPath();
      ctx.arc(0, 0, Math.abs(r), 0, Math.PI * 2);
      if (command.filled) {
        ctx.fillStyle = Color.toCSS(command.color);
        ctx.fill();
      } else {
        ctx.strokeStyle = Color.toCSS(command.color);
        ctx.lineWidth = Math.max(1, command.thickness * ppu);
        ctx.stroke();
      }
    });
  }

  drawLine(command) {
    const ctx = this.ctx;
    const view = this.view;
    if (!command.points || command.points.length < 2) return;
    ctx.save();
    ctx.globalAlpha = command.opacity ?? 1;
    ctx.strokeStyle = Color.toCSS(command.color);
    ctx.lineWidth = Math.max(1, command.thickness * view.pixelsPerUnit);
    ctx.beginPath();
    command.points.forEach((p, i) => {
      const s = worldToScreen(view, p.x, p.y);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  drawPolygon(command) {
    const ctx = this.ctx;
    const view = this.view;
    if (!command.points || command.points.length < 3) return;
    ctx.save();
    ctx.globalAlpha = command.opacity ?? 1;
    ctx.beginPath();
    command.points.forEach((p, i) => {
      const s = worldToScreen(view, p.x, p.y);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.closePath();
    if (command.filled) {
      ctx.fillStyle = Color.toCSS(command.color);
      ctx.fill();
    } else {
      ctx.strokeStyle = Color.toCSS(command.color);
      ctx.lineWidth = Math.max(1, command.thickness * view.pixelsPerUnit);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawText(command) {
    const ctx = this.ctx;
    const view = this.view;
    // World-space text measures `size` in world units; screen-space text
    // measures it in CSS pixels, matching how its position is authored.
    const px = command.screenSpace ? command.size : command.size * view.pixelsPerUnit;

    ctx.save();
    ctx.globalAlpha = command.opacity ?? 1;
    ctx.fillStyle = Color.toCSS(command.color);
    ctx.font =
      `${command.italic ? 'italic ' : ''}${command.bold ? 'bold ' : ''}` +
      `${Math.max(1, px)}px ${command.font}`;
    ctx.textAlign = command.align;
    ctx.textBaseline = command.baseline === 'middle' ? 'middle' : command.baseline;

    if (command.screenSpace) {
      // Screen-space text uses the entity position directly as CSS pixels from
      // the top-left, which is what a HUD wants.
      ctx.fillText(command.text, command.x, command.y);
    } else {
      const s = worldToScreen(view, command.x, command.y);
      ctx.translate(s.x, s.y);
      if (command.rotation) ctx.rotate(-command.rotation * (Math.PI / 180));
      ctx.fillText(command.text, 0, 0);
    }
    ctx.restore();
  }

  /** Grab the framebuffer as a data URL. Used by `sjl` screenshot tooling. */
  toDataURL(type = 'image/png') {
    return this.canvas.toDataURL(type);
  }

  destroy() {
    this.textures.clear();
  }
}

function isWhite(c) {
  return c.r === 1 && c.g === 1 && c.b === 1;
}
