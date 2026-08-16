/**
 * The editor.
 *
 * A scene tree, a schema-driven inspector, play/pause/step controls, and a
 * "copy scene JSON" button. It is not trying to be Unity — it is trying to be
 * the thing that closes the loop between a scene file and what you see.
 *
 * Two design choices carry the whole thing:
 *
 *   1. **The inspector is generated from component schemas.** There is no
 *      per-component editor UI anywhere in this file. Declare a component and
 *      its fields appear, with the right widget per type, ranges enforced. A
 *      game's own components get an inspector for free.
 *
 *   2. **The scene file is the source of truth, both ways.** Edits write into
 *      live component data, and "Copy JSON" serializes the world back into the
 *      exact format the scene file uses. So a human can drag something into
 *      place and paste the result into the file an agent is also editing —
 *      neither one owns the scene, the file does.
 */

import { App } from '../runtime/app.js';
import { WebGL2Renderer, isWebGL2Available } from '../render/webgl2.js';
import { Canvas2DRenderer } from '../render/canvas2d.js';
import { Assets } from '../assets/assets.js';
import { Input, DEFAULT_ACTIONS } from '../input/input.js';
import { SilentAudio, WebAudio } from '../audio/audio.js';
import { bindInput } from '../runtime/browser.js';
import { Scene } from '../scene/scene.js';
import { serializeWorld, stringifyScene } from '../scene/serialize.js';
import { validateScene, formatIssues } from '../scene/validate.js';
import { components as componentRegistry } from '../core/component.js';
import { behaviors as behaviorRegistry } from '../core/behavior.js';
import { computeView, screenToWorld } from '../render/renderer.js';
import { activeCamera } from '../systems/render.js';
import * as Color from '../math/color.js';
import '../index.js';

export class Editor {
  /**
   * @param {object} options
   * @param {HTMLElement} options.root      container for the whole editor
   * @param {string} [options.scene]        scene URL to open
   * @param {string} [options.baseUrl]
   */
  constructor(options = {}) {
    this.options = options;
    this.root = options.root;
    this.selected = null;
    this.playing = false;
    this.sceneUrl = options.scene ?? null;
    /** The scene as loaded, so Reset can restore it exactly. */
    this.sourceScene = null;

    this.buildLayout();
    this.createApp();
    this.bindKeys();
    this.loop();
  }

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  buildLayout() {
    this.root.innerHTML = '';
    this.root.className = 'sjl-editor';

    this.root.append(
      el('div', { class: 'sjl-toolbar' }, [
        (this.playButton = el('button', { class: 'sjl-btn sjl-primary', onclick: () => this.togglePlay() }, '▶ Play')),
        el('button', { class: 'sjl-btn', onclick: () => this.stepOnce() }, '⏭ Step'),
        el('button', { class: 'sjl-btn', onclick: () => this.reset() }, '↺ Reset'),
        el('span', { class: 'sjl-sep' }),
        (this.debugButton = el('button', { class: 'sjl-btn', onclick: () => this.toggleDebug() }, '◻ Colliders')),
        el('span', { class: 'sjl-spacer' }),
        (this.statsLabel = el('span', { class: 'sjl-stats' }, '')),
        el('span', { class: 'sjl-sep' }),
        el('button', { class: 'sjl-btn', onclick: () => this.copyJSON() }, '⧉ Copy JSON'),
        el('button', { class: 'sjl-btn', onclick: () => this.validate() }, '✓ Validate'),
      ]),
      el('div', { class: 'sjl-body' }, [
        el('aside', { class: 'sjl-panel sjl-left' }, [
          el('div', { class: 'sjl-panel-title' }, 'Hierarchy'),
          (this.treeEl = el('div', { class: 'sjl-tree' })),
        ]),
        el('main', { class: 'sjl-viewport' }, [(this.canvas = el('canvas', { tabindex: '0' }))]),
        el('aside', { class: 'sjl-panel sjl-right' }, [
          el('div', { class: 'sjl-panel-title' }, 'Inspector'),
          (this.inspectorEl = el('div', { class: 'sjl-inspector' })),
        ]),
      ]),
      (this.consoleEl = el('div', { class: 'sjl-console' })),
    );

    this.canvas.addEventListener('pointerdown', (event) => this.pickAt(event));
  }

  // -------------------------------------------------------------------------
  // App
  // -------------------------------------------------------------------------

  createApp() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(240, Math.floor(rect.height));

    const renderer = isWebGL2Available()
      ? new WebGL2Renderer(this.canvas, { width, height })
      : new Canvas2DRenderer(this.canvas, { width, height });

    let audio;
    try {
      audio = new WebAudio();
    } catch {
      audio = new SilentAudio();
    }

    const input = new Input({ actions: this.options.actions ?? DEFAULT_ACTIONS });
    const assets = new Assets({ baseUrl: this.options.baseUrl ?? '', renderer, audio });

    this.app = new App({ renderer, audio, input, assets, seed: this.options.seed });
    assets.events = this.app.world.events;
    this.detachInput = bindInput(this.canvas, input, audio);

    // Rebuild the tree whenever the world's shape changes, not every frame:
    // re-rendering the hierarchy at 60fps makes it impossible to click.
    this.lastWorldVersion = -1;

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        const r = this.canvas.parentElement.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) renderer.resize(Math.floor(r.width), Math.floor(r.height));
      }).observe(this.canvas.parentElement);
    }

    this.boot();
  }

  /**
   * Load the project's own components and behaviors, then open the scene.
   *
   * Without this the editor only knows the built-ins, and a scene referencing a
   * game's own behavior fails to load halfway through — leaving a half-built
   * world and a confusing "unknown behavior" error for something that is right
   * there in the project.
   */
  async boot() {
    const configUrl = this.options.config ?? `${this.options.baseUrl ?? ''}/sjl.config.json`;
    try {
      const response = await fetch(configUrl);
      if (response.ok) {
        const config = await response.json();
        for (const script of config.scripts ?? []) {
          const url = new URL(script.replace(/^\.?\//, ''), new URL(configUrl, location.href));
          try {
            await import(url.href);
          } catch (error) {
            this.log(`Could not load script "${script}": ${error.message}`, 'error');
          }
        }
        if (config.input?.actions) this.app.input.defineActions(config.input.actions);
      }
    } catch {
      // No config: the editor still works with the built-in components and
      // behaviors, which is the right outcome for a bare scene file.
    }

    if (this.sceneUrl) await this.openScene(this.sceneUrl);
  }

  async openScene(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const document = await response.json();
      this.sourceScene = document;
      await this.app.loadScene(Scene.parse(document));
      this.log(`Loaded ${url}`, 'ok');
      this.refreshTree(true);
    } catch (error) {
      this.log(`Could not open ${url}: ${error.message}`, 'error');
    }
  }

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  loop() {
    let last = performance.now();
    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      if (this.playing) {
        this.app.step(dt);
      } else {
        // Paused: still render, so the viewport reflects inspector edits.
        this.app.step(0);
      }

      if (this.app.world.version !== this.lastWorldVersion) {
        this.lastWorldVersion = this.app.world.version;
        this.refreshTree();
      }
      this.refreshStats();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  togglePlay() {
    this.playing = !this.playing;
    this.playButton.textContent = this.playing ? '⏸ Pause' : '▶ Play';
    this.playButton.classList.toggle('sjl-primary', !this.playing);
    if (this.playing) this.canvas.focus();
  }

  stepOnce() {
    this.playing = false;
    this.playButton.textContent = '▶ Play';
    this.app.step(1 / 60);
    this.refreshTree();
    this.refreshInspector();
  }

  reset() {
    if (!this.sourceScene) return;
    this.app.loadSceneSync(Scene.parse(this.sourceScene));
    this.selected = null;
    this.refreshTree(true);
    this.refreshInspector();
    this.log('Scene reset', 'ok');
  }

  toggleDebug() {
    const system = this.app.scheduler.get('DebugDrawSystem');
    const enabled = !system.enabled;
    this.app.setDebugDraw(enabled);
    this.debugButton.classList.toggle('sjl-active', enabled);
  }

  bindKeys() {
    window.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === ' ') {
        event.preventDefault();
        this.togglePlay();
      }
      if (event.key === '.') this.stepOnce();
      if (event.key === '`') this.toggleDebug();
      if (event.key === 'Delete' && this.selected?.alive) {
        this.app.world.destroy(this.selected.id);
        this.selected = null;
        this.refreshInspector();
      }
    });
  }

  refreshStats() {
    const time = this.app.time;
    const renderer = this.app.renderer;
    this.statsLabel.textContent =
      `${Math.round(time.fps)} fps · ${this.app.world.entityCount} entities · ` +
      `${renderer.stats.drawCalls} draws · frame ${time.frame}`;
  }

  // -------------------------------------------------------------------------
  // Hierarchy
  // -------------------------------------------------------------------------

  refreshTree(force = false) {
    const scrollTop = this.treeEl.scrollTop;
    this.treeEl.innerHTML = '';

    const walk = (entity, depth) => {
      const row = el(
        'div',
        {
          class: `sjl-node${this.selected?.id === entity.id ? ' sjl-selected' : ''}${entity.enabled ? '' : ' sjl-disabled'}`,
          style: `padding-left:${8 + depth * 14}px`,
          onclick: () => this.select(entity),
        },
        [
          el('span', { class: 'sjl-node-name' }, entity.name),
          el('span', { class: 'sjl-node-meta' }, entity.componentNames().length ? `${entity.componentNames().length}` : ''),
        ],
      );
      this.treeEl.append(row);
      for (const child of entity.children) walk(child, depth + 1);
    };

    for (const root of this.app.world.roots()) {
      // Engine-internal holders are noise in the hierarchy.
      if (root.name.startsWith('__')) continue;
      walk(root, 0);
    }
    if (!force) this.treeEl.scrollTop = scrollTop;
  }

  select(entity) {
    this.selected = entity;
    this.refreshTree();
    this.refreshInspector();
  }

  /** Click-to-select in the viewport, using the same draw list the renderer uses. */
  pickAt(event) {
    const cam = activeCamera(this.app.world);
    if (!cam) return;

    const rect = this.canvas.getBoundingClientRect();
    const view = computeView(cam.camera, cam.transform, this.app.renderer.width, this.app.renderer.height);
    const world = screenToWorld(view, event.clientX - rect.left, event.clientY - rect.top);

    // Topmost first, so clicking overlapping sprites picks the visible one.
    let best = null;
    for (const entity of this.app.world.query('WorldTransform')) {
      const wt = entity.get('WorldTransform');
      const size = entity.get('Sprite')?.size ?? entity.get('ShapeRenderer')?.size;
      if (!size) continue;
      const hw = (size.x * Math.abs(wt.scaleX)) / 2;
      const hh = (size.y * Math.abs(wt.scaleY)) / 2;
      if (Math.abs(world.x - wt.x) <= hw && Math.abs(world.y - wt.y) <= hh) {
        const layer = entity.get('Sprite')?.layer ?? entity.get('ShapeRenderer')?.layer ?? 0;
        if (!best || layer >= best.layer) best = { entity, layer };
      }
    }
    if (best) this.select(best.entity);
  }

  // -------------------------------------------------------------------------
  // Inspector — generated entirely from component schemas
  // -------------------------------------------------------------------------

  refreshInspector() {
    this.inspectorEl.innerHTML = '';
    const entity = this.selected;

    if (!entity?.alive) {
      this.inspectorEl.append(el('div', { class: 'sjl-empty' }, 'Select an entity'));
      return;
    }

    this.inspectorEl.append(
      el('div', { class: 'sjl-entity-header' }, [
        el('input', {
          class: 'sjl-name-input',
          value: entity.name,
          oninput: (event) => {
            entity.name = event.target.value;
            this.refreshTree();
          },
        }),
        el('label', { class: 'sjl-toggle' }, [
          el('input', {
            type: 'checkbox',
            checked: entity.enabled ? 'checked' : null,
            onchange: (event) => {
              entity.enabled = event.target.checked;
              this.refreshTree();
            },
          }),
          el('span', {}, 'enabled'),
        ]),
      ]),
      el('div', { class: 'sjl-entity-meta' }, [
        el('span', {}, `#${entity.id}`),
        ...(entity.sceneId ? [el('span', { class: 'sjl-chip' }, entity.sceneId)] : []),
        ...[...entity.tags].map((tag) => el('span', { class: 'sjl-chip sjl-tag' }, `#${tag}`)),
      ]),
    );

    for (const name of entity.componentNames()) {
      const definition = componentRegistry.get(name);
      if (!definition || name === 'Behaviors') continue;
      this.inspectorEl.append(this.componentSection(entity, definition));
    }

    const behaviorItems = entity.get('Behaviors')?.items ?? [];
    for (const instance of behaviorItems) {
      this.inspectorEl.append(this.behaviorSection(instance));
    }

    this.inspectorEl.append(this.addComponentMenu(entity));
  }

  componentSection(entity, definition) {
    const data = entity.get(definition.name);
    const body = el('div', { class: 'sjl-fields' });

    for (const [fieldName, field] of Object.entries(definition.schema)) {
      if (field.type === 'any') continue; // Internal state; nothing sensible to show.
      body.append(this.fieldRow(fieldName, field, data));
    }

    return el('section', { class: 'sjl-component' }, [
      el('header', { class: 'sjl-component-header', title: definition.description }, [
        el('span', {}, definition.name),
        ...(definition.runtime
          ? [el('span', { class: 'sjl-chip sjl-readonly' }, 'runtime')]
          : [
              el('button', {
                class: 'sjl-remove',
                title: `Remove ${definition.name}`,
                onclick: () => {
                  entity.remove(definition.name);
                  this.refreshInspector();
                },
              }, '×'),
            ]),
      ]),
      body,
    ]);
  }

  behaviorSection(instance) {
    const body = el('div', { class: 'sjl-fields' });
    for (const [propName, field] of Object.entries(instance.definition.props)) {
      body.append(this.fieldRow(propName, field, instance.props));
    }
    return el('section', { class: 'sjl-component sjl-behavior' }, [
      el('header', { class: 'sjl-component-header', title: instance.definition.description }, [
        el('span', {}, instance.type),
        el('label', { class: 'sjl-toggle' }, [
          el('input', {
            type: 'checkbox',
            checked: instance.enabled ? 'checked' : null,
            onchange: (event) => instance.setEnabled(event.target.checked, {}),
          }),
        ]),
      ]),
      body,
    ]);
  }

  /**
   * One row of the inspector.
   *
   * The widget is chosen by the field's declared `type` — this switch is the
   * only place the editor knows anything about component data, and adding a
   * component anywhere in the codebase gets a working inspector with no changes
   * here.
   */
  fieldRow(name, field, data) {
    const label = el('label', { class: 'sjl-field-label', title: field.description ?? '' }, name);
    let control;

    const commit = (value) => {
      data[name] = value;
    };

    switch (field.type) {
      case 'number':
      case 'int': {
        control = el('input', {
          type: 'number',
          class: 'sjl-input',
          value: String(data[name] ?? 0),
          step: field.type === 'int' ? '1' : (field.step ?? 'any'),
          ...(field.min !== undefined ? { min: String(field.min) } : {}),
          ...(field.max !== undefined ? { max: String(field.max) } : {}),
          oninput: (event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) commit(field.type === 'int' ? Math.round(parsed) : parsed);
          },
        });
        break;
      }
      case 'boolean': {
        control = el('input', {
          type: 'checkbox',
          class: 'sjl-checkbox',
          checked: data[name] ? 'checked' : null,
          onchange: (event) => commit(event.target.checked),
        });
        break;
      }
      case 'enum': {
        control = el(
          'select',
          { class: 'sjl-input', onchange: (event) => commit(event.target.value) },
          (field.values ?? []).map((value) =>
            el('option', { value, selected: data[name] === value ? 'selected' : null }, value),
          ),
        );
        break;
      }
      case 'vec2': {
        const vector = data[name] ?? { x: 0, y: 0 };
        const axis = (key) =>
          el('input', {
            type: 'number',
            class: 'sjl-input sjl-input-half',
            value: String(vector[key] ?? 0),
            step: 'any',
            oninput: (event) => {
              const parsed = Number(event.target.value);
              if (Number.isFinite(parsed)) vector[key] = parsed;
            },
          });
        control = el('div', { class: 'sjl-vec' }, [axis('x'), axis('y')]);
        break;
      }
      case 'color': {
        const current = data[name] ?? Color.WHITE;
        control = el('div', { class: 'sjl-vec' }, [
          el('input', {
            type: 'color',
            class: 'sjl-color',
            value: Color.toHex(current),
            oninput: (event) => Color.fromAny(event.target.value, data[name]),
          }),
          el('input', {
            type: 'number',
            class: 'sjl-input sjl-input-half',
            value: String(current.a ?? 1),
            min: '0',
            max: '1',
            step: '0.05',
            title: 'alpha',
            oninput: (event) => {
              const parsed = Number(event.target.value);
              if (Number.isFinite(parsed)) data[name].a = Math.max(0, Math.min(1, parsed));
            },
          }),
        ]);
        break;
      }
      case 'array': {
        control = el('span', { class: 'sjl-readonly-value' }, `${(data[name] ?? []).length} item(s)`);
        break;
      }
      case 'object': {
        control = el('span', { class: 'sjl-readonly-value' }, '{…}');
        break;
      }
      default: {
        control = el('input', {
          type: 'text',
          class: 'sjl-input',
          value: String(data[name] ?? ''),
          placeholder: field.type,
          oninput: (event) => commit(event.target.value),
        });
      }
    }

    return el('div', { class: 'sjl-field' }, [label, control]);
  }

  addComponentMenu(entity) {
    const missing = componentRegistry
      .all()
      .filter((c) => !c.runtime && c.name !== 'Behaviors' && !entity.has(c.name))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

    const select = el(
      'select',
      {
        class: 'sjl-input',
        onchange: (event) => {
          if (!event.target.value) return;
          entity.add(event.target.value);
          event.target.value = '';
          this.refreshInspector();
        },
      },
      [
        el('option', { value: '' }, '+ Add component'),
        ...missing.map((c) => el('option', { value: c.name, title: c.description }, `${c.category} / ${c.name}`)),
      ],
    );

    const behaviorSelect = el(
      'select',
      {
        class: 'sjl-input',
        onchange: async (event) => {
          if (!event.target.value) return;
          const { addBehavior } = await import('../scene/scene.js');
          addBehavior(entity, event.target.value);
          event.target.value = '';
          this.refreshInspector();
        },
      },
      [
        el('option', { value: '' }, '+ Add behavior'),
        ...behaviorRegistry.all().map((b) => el('option', { value: b.name, title: b.description }, b.name)),
      ],
    );

    return el('div', { class: 'sjl-add' }, [select, behaviorSelect]);
  }

  // -------------------------------------------------------------------------
  // Output
  // -------------------------------------------------------------------------

  async copyJSON() {
    const text = stringifyScene(serializeWorld(this.app.world));
    try {
      await navigator.clipboard.writeText(text);
      this.log('Scene JSON copied to the clipboard', 'ok');
    } catch {
      // Clipboard access needs a secure context; printing is the fallback.
      console.log(text);
      this.log('Clipboard blocked — the scene JSON was printed to the console instead', 'warn');
    }
  }

  validate() {
    const document = serializeWorld(this.app.world);
    const issues = validateScene(document);
    if (issues.length === 0) {
      this.log('Scene is valid', 'ok');
      return;
    }
    this.log(`${issues.length} issue(s):\n${formatIssues(issues)}`, 'error');
  }

  log(message, level = 'info') {
    const line = el('div', { class: `sjl-log sjl-log-${level}` }, message);
    this.consoleEl.prepend(line);
    while (this.consoleEl.childElementCount > 40) this.consoleEl.lastElementChild.remove();
  }

  destroy() {
    this.detachInput?.();
    this.app.stop();
  }
}

/** Minimal DOM helper. Attributes starting with `on` become listeners. */
function el(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else if (key === 'value' && 'value' in node) {
      node.value = value;
    } else if (key === 'checked') {
      node.checked = true;
    } else {
      node.setAttribute(key, value);
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** Mount the editor into a container. */
export function createEditor(options) {
  const root = typeof options.root === 'string' ? document.querySelector(options.root) : options.root;
  if (!root) throw new Error(`createEditor: no element matches "${options.root}"`);
  return new Editor({ ...options, root });
}
