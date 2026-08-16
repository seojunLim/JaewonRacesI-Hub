/**
 * Scene validation.
 *
 * This is the single highest-leverage feature in the engine for AI-assisted
 * development. A generated scene file usually fails in one of a handful of
 * boring ways — a misspelled component, a field that does not exist, an entity
 * reference pointing at nothing, an animation clip that was never declared —
 * and every one of them produces a game that loads and then behaves wrong, with
 * no error anywhere.
 *
 * `sjl validate` catches all of them before the game runs, reports *every*
 * problem at once (not just the first), and includes a suggestion for each. The
 * agent fixes the whole list in one pass instead of discovering the problems
 * one runtime session at a time.
 */

import { components as globalComponents } from '../core/component.js';
import { behaviors as globalBehaviors } from '../core/behavior.js';
import { closestMatch } from '../core/schema.js';
import { ENTITY_KEYS, SCENE_KEYS } from './scene.js';

/**
 * @typedef {object} SceneIssue
 * @property {string} path            e.g. `entities[2].components.Sprite.colour`
 * @property {string} message
 * @property {'error'|'warning'} severity
 * @property {string} [suggestion]
 */

/**
 * Validate a scene document.
 *
 * @param {object} document
 * @param {object} [options]
 * @param {import('../core/component.js').ComponentRegistry} [options.components]
 * @param {import('../core/behavior.js').BehaviorRegistry} [options.behaviors]
 * @param {boolean} [options.checkBehaviors=true] verify behavior types are registered
 * @returns {SceneIssue[]}
 */
export function validateScene(document, options = {}) {
  const components = options.components ?? globalComponents;
  const behaviors = options.behaviors ?? globalBehaviors;
  const checkBehaviors = options.checkBehaviors ?? true;

  /** @type {SceneIssue[]} */
  const issues = [];
  const error = (path, message, suggestion) =>
    issues.push({ path, message, severity: 'error', ...(suggestion ? { suggestion } : {}) });
  const warn = (path, message, suggestion) =>
    issues.push({ path, message, severity: 'warning', ...(suggestion ? { suggestion } : {}) });

  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    error('', `A scene must be a JSON object, got ${Array.isArray(document) ? 'array' : typeof document}`);
    return issues;
  }

  for (const key of Object.keys(document)) {
    if (SCENE_KEYS.includes(key)) continue;
    error(key, `Unknown top-level key "${key}"`, closestMatch(key, SCENE_KEYS) ?? SCENE_KEYS.join(' | '));
  }

  if (document.entities !== undefined && !Array.isArray(document.entities)) {
    error('entities', '`entities` must be an array');
  }

  // ---- assets -------------------------------------------------------------
  const assetIds = new Set();
  const assetTypes = new Map();
  if (document.assets !== undefined) {
    if (!Array.isArray(document.assets)) {
      error('assets', '`assets` must be an array of { id, type, src }');
    } else {
      document.assets.forEach((asset, i) => {
        const path = `assets[${i}]`;
        if (!asset?.id) error(`${path}.id`, 'Every asset needs an `id`');
        else if (assetIds.has(asset.id)) error(`${path}.id`, `Duplicate asset id "${asset.id}"`);
        else {
          assetIds.add(asset.id);
          assetTypes.set(asset.id, asset.type ?? 'texture');
        }
        if (!asset?.type) warn(`${path}.type`, 'Asset has no `type`; assuming "texture"');
        if (!asset?.src && asset?.type !== 'inline') {
          error(`${path}.src`, `Asset "${asset?.id ?? i}" has no \`src\``);
        }
      });
    }
  }

  // ---- prefabs ------------------------------------------------------------
  const prefabNames = new Set(Object.keys(document.prefabs ?? {}));
  for (const [name, prefab] of Object.entries(document.prefabs ?? {})) {
    validateEntityNode(prefab, `prefabs.${name}`, {
      components,
      behaviors,
      checkBehaviors,
      assetIds,
      assetTypes,
      prefabNames,
      error,
      warn,
      // A prefab is a template, so `id` on it is a definition-level id, not a
      // scene-unique one — collisions are checked only among real entities.
      sceneIds: null,
      allowPrefabRef: true,
    });
  }

  // ---- entities -----------------------------------------------------------
  /** @type {Map<string, string>} scene id -> where it was declared */
  const sceneIds = new Map();
  const entityRefs = [];

  const walk = (node, path) => {
    validateEntityNode(node, path, {
      components,
      behaviors,
      checkBehaviors,
      assetIds,
      assetTypes,
      prefabNames,
      error,
      warn,
      sceneIds,
      entityRefs,
      allowPrefabRef: true,
    });
    (node?.children ?? []).forEach((child, i) => walk(child, `${path}.children[${i}]`));
  };

  (document.entities ?? []).forEach((node, i) => walk(node, `entities[${i}]`));

  // Prefab-declared ids also become real scene ids once instanced.
  for (const [name, prefab] of Object.entries(document.prefabs ?? {})) {
    if (prefab?.id) sceneIds.set(prefab.id, `prefabs.${name}`);
  }

  // ---- cross-references ---------------------------------------------------
  for (const ref of entityRefs) {
    if (!ref.value) continue;
    if (sceneIds.has(ref.value)) continue;
    const suggestion = closestMatch(ref.value, [...sceneIds.keys()]);
    error(
      ref.path,
      `References entity id "${ref.value}", which no entity in this scene declares`,
      suggestion ?? `Declared ids: ${[...sceneIds.keys()].join(', ') || '(none)'}`,
    );
  }

  return issues;
}

/** Validate one entity node: keys, components, behaviors, references. */
function validateEntityNode(node, path, ctx) {
  const { error, warn, components, behaviors, checkBehaviors, assetIds, assetTypes, prefabNames } = ctx;

  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    error(path, `An entity must be a JSON object, got ${Array.isArray(node) ? 'array' : typeof node}`);
    return;
  }

  for (const key of Object.keys(node)) {
    if (ENTITY_KEYS.includes(key)) continue;
    error(
      `${path}.${key}`,
      `Unknown entity key "${key}"`,
      closestMatch(key, ENTITY_KEYS) ?? ENTITY_KEYS.join(' | '),
    );
  }

  if (node.id !== undefined) {
    if (typeof node.id !== 'string') {
      error(`${path}.id`, '`id` must be a string');
    } else if (ctx.sceneIds) {
      const existing = ctx.sceneIds.get(node.id);
      if (existing) {
        error(
          `${path}.id`,
          `Duplicate entity id "${node.id}" (already declared at ${existing}). ` +
            'Ids must be unique so that references resolve to one entity.',
        );
      } else {
        ctx.sceneIds.set(node.id, path);
      }
    }
  }

  if (node.tags !== undefined && !Array.isArray(node.tags)) {
    error(`${path}.tags`, '`tags` must be an array of strings');
  }

  if (node.prefab !== undefined) {
    if (!ctx.allowPrefabRef) {
      error(`${path}.prefab`, 'Prefab references are not allowed here');
    } else if (!prefabNames.has(node.prefab)) {
      error(
        `${path}.prefab`,
        `Unknown prefab "${node.prefab}"`,
        closestMatch(node.prefab, [...prefabNames]) ?? `Defined: ${[...prefabNames].join(', ') || '(none)'}`,
      );
    }
  }

  // ---- components ---------------------------------------------------------
  if (node.components !== undefined) {
    if (typeof node.components !== 'object' || Array.isArray(node.components)) {
      error(`${path}.components`, '`components` must be an object keyed by component name');
    } else {
      for (const [name, values] of Object.entries(node.components)) {
        const componentPath = `${path}.components.${name}`;
        const definition = components.get(name);
        if (!definition) {
          error(
            componentPath,
            `Unknown component "${name}"`,
            closestMatch(name, components.names()) ?? `Registered: ${components.names().join(', ')}`,
          );
          continue;
        }
        if (definition.runtime) {
          warn(
            componentPath,
            `"${name}" is computed at runtime and will be overwritten; remove it from the scene file`,
          );
        }
        if (typeof values !== 'object' || values === null || Array.isArray(values)) {
          error(componentPath, `Component values must be an object, got ${typeof values}`);
          continue;
        }

        for (const issue of definition.validate(values, componentPath)) {
          error(issue.path, issue.message, issue.expected);
        }

        for (const required of definition.requires) {
          if (!node.components[required] && !node.prefab) {
            warn(
              componentPath,
              `"${name}" requires "${required}", which will be added automatically with default values`,
            );
          }
        }

        collectReferences(definition, values, componentPath, ctx, assetIds, assetTypes);
      }

      validateAnimatorClips(node, path, error);
      validateDimensionMixing(node, path, error, warn);
    }
  }

  // ---- behaviors ----------------------------------------------------------
  if (node.behaviors !== undefined) {
    if (!Array.isArray(node.behaviors)) {
      error(`${path}.behaviors`, '`behaviors` must be an array of { type, ...props }');
    } else {
      node.behaviors.forEach((entry, i) => {
        const behaviorPath = `${path}.behaviors[${i}]`;
        if (typeof entry !== 'object' || entry === null) {
          error(behaviorPath, 'A behavior entry must be an object with a `type`');
          return;
        }
        if (!entry.type) {
          error(`${behaviorPath}.type`, 'A behavior entry needs a `type`');
          return;
        }
        if (!checkBehaviors) return;

        const definition = behaviors.get(entry.type);
        if (!definition) {
          // A warning, not an error: behaviors are registered by game code that
          // the validator may not have loaded. `sjl validate --project` loads it
          // and upgrades this to an error.
          warn(
            `${behaviorPath}.type`,
            `Behavior "${entry.type}" is not registered in this process, so its props cannot be checked`,
            closestMatch(entry.type, behaviors.names()) ?? undefined,
          );
          return;
        }
        const props = entry.props ?? flatProps(entry);
        for (const issue of definition.validateProps(props, `${behaviorPath}`)) {
          error(issue.path, issue.message, issue.expected);
        }
      });
    }
  }

  if (node.children !== undefined && !Array.isArray(node.children)) {
    error(`${path}.children`, '`children` must be an array of entity objects');
  }
}

/** Record entity references and check asset references. */
function collectReferences(definition, values, componentPath, ctx, assetIds, assetTypes) {
  for (const [field, schema] of Object.entries(definition.schema)) {
    const value = values[field];
    if (value === undefined || value === null || value === '') continue;

    if (schema.type === 'entity' && ctx.entityRefs) {
      ctx.entityRefs.push({ path: `${componentPath}.${field}`, value });
    }

    if (schema.type === 'asset') {
      if (!assetIds.has(value)) {
        ctx.error(
          `${componentPath}.${field}`,
          `References asset "${value}", which is not declared in this scene's \`assets\``,
          closestMatch(value, [...assetIds]) ?? `Declared: ${[...assetIds].join(', ') || '(none)'}`,
        );
      } else if (schema.assetType && assetTypes.get(value) !== schema.assetType) {
        ctx.error(
          `${componentPath}.${field}`,
          `Expected a "${schema.assetType}" asset but "${value}" is declared as ` +
            `"${assetTypes.get(value)}"`,
        );
      }
    }
  }
}

/**
 * A SpriteAnimator whose `current` names a clip it does not have is a silent
 * freeze at runtime — the sprite simply never animates and nothing complains.
 */
function validateAnimatorClips(node, path, error) {
  const animator = node.components?.SpriteAnimator;
  if (!animator?.current) return;
  const clips = (animator.clips ?? []).map((c) => c?.name).filter(Boolean);
  if (clips.includes(animator.current)) return;
  error(
    `${path}.components.SpriteAnimator.current`,
    `Clip "${animator.current}" is not declared in \`clips\``,
    closestMatch(animator.current, clips) ?? `Declared clips: ${clips.join(', ') || '(none)'}`,
  );
}

/**
 * Catch 2D and 3D components on the same entity.
 *
 * The two sets are independent by design, and mixing them on one entity is
 * always a mistake — the 2D systems move `Transform` while the 3D systems move
 * `Transform3D`, so the entity renders in one place and collides in another,
 * with no error anywhere. This is the single most likely way to get 3D wrong,
 * so it is an error rather than a warning.
 *
 * Mixing them across *different* entities is fine and is how a 2D HUD over a 3D
 * world works.
 */
function validateDimensionMixing(node, path, error, warn) {
  const components = node.components ?? {};
  const has2D = COMPONENT_PAIRS.filter(([two]) => components[two]);
  const has3D = COMPONENT_PAIRS.filter(([, three]) => components[three]);

  if (has2D.length > 0 && has3D.length > 0) {
    error(
      `${path}.components`,
      `Mixes 2D and 3D components on one entity (${has2D[0][0]} and ${has3D[0][1]}). ` +
        'They are moved by different systems, so the entity would render and collide ' +
        'in different places.',
      `Use either the 2D set (${has2D.map((p) => p[0]).join(', ')}) or the 3D set ` +
        `(${has3D.map((p) => p[1]).join(', ')}), not both`,
    );
    return;
  }

  // A 3D renderer or collider with no Transform3D silently does nothing.
  const needs3DTransform = ['MeshRenderer', 'Camera3D', 'Light', 'Rigidbody3D', 'BoxCollider3D', 'SphereCollider'];
  const present = needs3DTransform.filter((name) => components[name]);
  if (present.length > 0 && !components.Transform3D && !node.prefab) {
    warn(
      `${path}.components`,
      `${present.join(', ')} requires Transform3D, which will be added with default values`,
    );
  }
}

/** 2D component and its 3D counterpart. Used for the mixing check. */
const COMPONENT_PAIRS = [
  ['Transform', 'Transform3D'],
  ['Camera', 'Camera3D'],
  ['Rigidbody', 'Rigidbody3D'],
  ['BoxCollider', 'BoxCollider3D'],
  ['CircleCollider', 'SphereCollider'],
  ['Sprite', 'MeshRenderer'],
  ['ShapeRenderer', 'MeshRenderer'],
];

function flatProps(entry) {
  const props = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'type' || key === 'enabled' || key === 'props') continue;
    props[key] = value;
  }
  return props;
}

/** Human-readable report. Used by the CLI's default output. */
export function formatIssues(issues, { color = false } = {}) {
  if (issues.length === 0) return 'No problems found.';
  const red = color ? '[31m' : '';
  const yellow = color ? '[33m' : '';
  const dim = color ? '[2m' : '';
  const reset = color ? '[0m' : '';

  return issues
    .map((issue) => {
      const tag = issue.severity === 'warning' ? `${yellow}warning${reset}` : `${red}error${reset}`;
      const suggestion = issue.suggestion ? `\n    ${dim}hint: ${issue.suggestion}${reset}` : '';
      return `  ${tag} ${issue.path || '<root>'}\n    ${issue.message}${suggestion}`;
    })
    .join('\n');
}
