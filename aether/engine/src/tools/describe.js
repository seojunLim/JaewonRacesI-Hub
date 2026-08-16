/**
 * Engine introspection.
 *
 * `describeEngine()` returns the complete API surface as JSON: every component
 * with every field and its type, every behavior with its props and hooks, the
 * system schedule in execution order, and the event catalog.
 *
 * This exists because of how coding agents actually fail on a game engine. They
 * do not fail at logic; they fail by inventing a component field that sounds
 * right (`Sprite.tint`, `Rigidbody.bounciness`) and producing a scene that loads
 * and behaves wrong. Handing the model the real manifest — cheaply, in one
 * command, in a form it can read without grepping the source — removes that
 * entire failure mode.
 *
 *   sjl describe --json    # the manifest, for tools
 *   sjl describe           # the same thing as readable Markdown, for prompts
 */

import { components as globalComponents } from '../core/component.js';
import { behaviors as globalBehaviors } from '../core/behavior.js';
import { EngineEvents, EngineEventPayloads } from '../core/events.js';
import { PHASE_ORDER, FIXED_PHASES } from '../core/system.js';
import { builtinSystems } from '../systems/index.js';
import { DEFAULT_ACTIONS } from '../input/input.js';
import { ASSET_TYPES } from '../assets/assets.js';
import { EASING_NAMES } from '../math/scalar.js';
import { ENTITY_KEYS, SCENE_KEYS } from '../scene/scene.js';
import { VERSION } from '../version.js';

/**
 * The full manifest.
 *
 * @param {object} [options]
 * @param {import('../core/component.js').ComponentRegistry} [options.components]
 * @param {import('../core/behavior.js').BehaviorRegistry} [options.behaviors]
 * @param {import('../core/system.js').Scheduler} [options.scheduler] a live scheduler,
 *        if you want the actual schedule of a running app rather than the defaults
 */
export function describeEngine(options = {}) {
  const componentRegistry = options.components ?? globalComponents;
  const behaviorRegistry = options.behaviors ?? globalBehaviors;

  const systems = options.scheduler
    ? options.scheduler.describe()
    : describeDefaultSystems();

  return {
    engine: 'sjl-engine',
    version: VERSION,
    conventions: {
      axes: '+x right, +y up. Angles increase counter-clockwise.',
      rotationUnits: 'degrees, everywhere a user touches them',
      positionUnits: 'world units; the camera decides how many pixels one unit is',
      timestep: 'gameplay runs at a fixed 1/60s step; rendering runs at display rate',
      determinism:
        'given the same scene, seed and input sequence, every run produces identical state',
    },
    sceneFormat: {
      topLevelKeys: SCENE_KEYS,
      entityKeys: ENTITY_KEYS,
      settings: {
        gravity: 'vec2, default [0, -20]',
        seed: 'number or string; makes the run reproducible',
        physics: 'PhysicsSettings fields',
        timeScale: 'number, default 1',
      },
      assetTypes: ASSET_TYPES,
      prefabs:
        'A map of name -> entity node. Instance one with { "prefab": "Name", "components": {...} }; ' +
        'the instance overrides only the fields it mentions.',
      behaviors:
        'An entity-level array. Both { "type": "X", "props": { ... } } and the flat ' +
        '{ "type": "X", ...props } forms are accepted.',
      entityReferences:
        'Fields of type `entity` hold the string `id` of another entity in the same scene. ' +
        '`sjl validate` verifies they resolve.',
    },
    components: componentRegistry.describe(),
    behaviors: behaviorRegistry.describe(),
    systems,
    events: Object.entries(EngineEvents).map(([constant, name]) => ({
      constant,
      name,
      payload: EngineEventPayloads[name] ?? '{}',
    })),
    inputActions: Object.entries(DEFAULT_ACTIONS).map(([name, binding]) => ({
      name,
      type: binding.type,
      description: binding.description ?? '',
      bindings: [...(binding.keys ?? []), ...(binding.positive ?? []), ...(binding.negative ?? [])],
    })),
    easings: EASING_NAMES,
    api: describeApi(),
  };
}

function describeDefaultSystems() {
  const byPhase = new Map(PHASE_ORDER.map((p) => [p, []]));
  for (const system of builtinSystems()) {
    byPhase.get(system.phase).push(system.describe());
  }
  for (const list of byPhase.values()) list.sort((a, b) => a.order - b.order);

  return PHASE_ORDER.map((phase) => ({
    phase,
    fixed: FIXED_PHASES.includes(phase),
    systems: byPhase.get(phase),
  })).filter((p) => p.systems.length > 0);
}

/** The handful of functions worth knowing, with signatures. */
function describeApi() {
  return [
    { name: 'new App(options)', description: 'Create a game. Owns the world, scheduler and clock.' },
    { name: 'app.loadScene(scene)', description: 'Load a scene document or file path. Async; loads assets.' },
    { name: 'app.loadSceneSync(scene)', description: 'Load without waiting on assets. For tests.' },
    { name: 'app.step(dt)', description: 'Advance one frame. Returns the fixed-step count.' },
    { name: 'app.run(frames, dt?)', description: 'Advance N frames at a constant dt.' },
    { name: 'app.runUntil(predicate, opts?)', description: 'Step until a condition holds. Returns whether it did.' },
    { name: 'app.inspect()', description: 'Full JSON snapshot: clock, entities, systems, input.' },
    { name: 'app.tree()', description: 'The scene graph as indented text.' },
    { name: 'app.find(name)', description: 'Find an entity by name, then scene id, then tag.' },
    { name: 'world.query(...names)', description: 'Entities having all named components. Skips disabled ones.' },
    { name: 'world.each(...names)', description: 'Iterate [entity, ...componentData] tuples.' },
    { name: 'world.create(options)', description: 'Create an entity: { name, tags, parent, components }.' },
    { name: 'world.destroy(id)', description: 'Destroy an entity and its descendants. Deferred during iteration.' },
    { name: 'entity.get(name) / require(name)', description: 'Component data; `require` throws if absent.' },
    { name: 'entity.add(name, values) / remove(name)', description: 'Attach or detach a component.' },
    { name: 'defineComponent({ name, schema })', description: 'Declare a component. Schema drives everything.' },
    { name: 'defineBehavior({ name, props, onFixedUpdate })', description: 'Declare per-entity game logic.' },
    { name: 'defineSystem({ name, phase, update })', description: 'Declare a system that runs over queries.' },
    { name: 'instantiate(world, node)', description: 'Spawn an entity or prefab into a live world.' },
    { name: 'getPhysics(world).raycast(origin, dir, opts)', description: 'Nearest hit along a ray, or null.' },
    { name: 'getPhysics(world).overlapCircle(center, r)', description: 'Entities overlapping a circle.' },
    { name: 'getInput(world).isDown(action)', description: 'Is an input action held?' },
    { name: 'getInput(world).pressed(action)', description: 'Did it go down this frame?' },
    { name: 'getInput(world).axis(action)', description: 'Axis value in -1..1.' },
    { name: 'input.press(action) / release(action)', description: 'Drive input from a test or an agent.' },
    { name: 'serializeWorld(world)', description: 'The live world back to a scene document.' },
    { name: 'validateScene(document)', description: 'Every problem in a scene, with suggestions.' },
  ];
}

/**
 * The manifest as Markdown.
 *
 * This is the form you paste into a prompt or check into the repo as
 * `docs/api.md`. It is generated, never hand-written, so it cannot drift from
 * the code.
 */
export function describeMarkdown(options = {}) {
  const manifest = describeEngine(options);
  const out = [];

  out.push(`# SJL Engine API (v${manifest.version})`);
  out.push('');
  out.push('> Generated by `sjl describe --markdown`. Do not edit by hand.');
  out.push('');

  out.push('## Conventions');
  out.push('');
  for (const [key, value] of Object.entries(manifest.conventions)) {
    out.push(`- **${key}** — ${value}`);
  }
  out.push('');

  out.push('## Scene file');
  out.push('');
  out.push(`Top-level keys: ${manifest.sceneFormat.topLevelKeys.map((k) => `\`${k}\``).join(', ')}`);
  out.push('');
  out.push(`Entity keys: ${manifest.sceneFormat.entityKeys.map((k) => `\`${k}\``).join(', ')}`);
  out.push('');
  out.push(`- **prefabs** — ${manifest.sceneFormat.prefabs}`);
  out.push(`- **behaviors** — ${manifest.sceneFormat.behaviors}`);
  out.push(`- **entity references** — ${manifest.sceneFormat.entityReferences}`);
  out.push('');

  out.push('## Components');
  out.push('');
  const byCategory = new Map();
  for (const component of manifest.components) {
    if (!byCategory.has(component.category)) byCategory.set(component.category, []);
    byCategory.get(component.category).push(component);
  }
  for (const [category, list] of [...byCategory].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push(`### ${category}`);
    out.push('');
    for (const component of list) {
      const flags = [];
      if (component.singleton) flags.push('singleton');
      if (component.runtime) flags.push('runtime-computed — do not author');
      out.push(`#### \`${component.name}\`${flags.length ? ` *(${flags.join(', ')})*` : ''}`);
      out.push('');
      if (component.description) {
        out.push(component.description.split('\n').map((l) => l.trim()).join('  \n'));
        out.push('');
      }
      if (component.requires.length) {
        out.push(`Requires: ${component.requires.map((r) => `\`${r}\``).join(', ')}`);
        out.push('');
      }
      if (component.fields.length) {
        out.push('| field | type | default | description |');
        out.push('| --- | --- | --- | --- |');
        for (const field of component.fields) {
          const type = field.values ? field.values.join(' \\| ') : field.type;
          const def = field.default === undefined ? '' : `\`${JSON.stringify(field.default)}\``;
          out.push(`| \`${field.name}\` | ${type} | ${def} | ${escapePipes(field.description)} |`);
        }
        out.push('');
      }
    }
  }

  out.push('## Behaviors');
  out.push('');
  for (const behavior of manifest.behaviors) {
    out.push(`### \`${behavior.name}\``);
    out.push('');
    if (behavior.description) {
      out.push(behavior.description);
      out.push('');
    }
    out.push(`Hooks: ${behavior.hooks.map((h) => `\`${h}\``).join(', ') || '(none)'}`);
    out.push('');
    if (behavior.props.length) {
      out.push('| prop | type | default | description |');
      out.push('| --- | --- | --- | --- |');
      for (const prop of behavior.props) {
        const type = prop.values ? prop.values.join(' \\| ') : prop.type;
        const def = prop.default === undefined ? '' : `\`${JSON.stringify(prop.default)}\``;
        out.push(`| \`${prop.name}\` | ${type} | ${def} | ${escapePipes(prop.description)} |`);
      }
      out.push('');
    }
  }

  out.push('## System schedule');
  out.push('');
  out.push('Systems run top to bottom every frame. Phases marked *fixed* run 0..n times per frame.');
  out.push('');
  for (const phase of manifest.systems) {
    out.push(`### ${phase.phase}${phase.fixed ? ' *(fixed timestep)*' : ''}`);
    out.push('');
    for (const system of phase.systems) {
      out.push(`- \`${system.name}\` — ${system.description || '(no description)'}`);
    }
    out.push('');
  }

  out.push('## Events');
  out.push('');
  out.push('| event | payload |');
  out.push('| --- | --- |');
  for (const event of manifest.events) {
    out.push(`| \`${event.name}\` | \`${escapePipes(event.payload)}\` |`);
  }
  out.push('');

  out.push('## Default input actions');
  out.push('');
  out.push('| action | type | bindings |');
  out.push('| --- | --- | --- |');
  for (const action of manifest.inputActions) {
    out.push(`| \`${action.name}\` | ${action.type} | ${action.bindings.map((b) => `\`${b}\``).join(', ')} |`);
  }
  out.push('');

  out.push('## Core API');
  out.push('');
  for (const entry of manifest.api) {
    out.push(`- \`${entry.name}\` — ${entry.description}`);
  }
  out.push('');

  out.push('## Easing curves');
  out.push('');
  out.push(manifest.easings.map((e) => `\`${e}\``).join(', '));
  out.push('');

  return out.join('\n');
}

function escapePipes(text) {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * A terse summary that fits comfortably in a prompt: component and behavior
 * names with their field signatures, nothing else.
 */
export function describeCompact(options = {}) {
  const manifest = describeEngine(options);
  const out = [];

  out.push('COMPONENTS');
  for (const component of manifest.components) {
    if (component.runtime) continue;
    const fields = component.fields.map((f) => `${f.name}:${f.values ? f.values.join('|') : f.type}`);
    out.push(`  ${component.name}(${fields.join(', ')})`);
  }
  out.push('');
  out.push('BEHAVIORS');
  for (const behavior of manifest.behaviors) {
    const props = behavior.props.map((p) => `${p.name}:${p.values ? p.values.join('|') : p.type}`);
    out.push(`  ${behavior.name}(${props.join(', ')})`);
  }
  return out.join('\n');
}
