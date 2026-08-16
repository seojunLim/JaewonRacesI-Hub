/**
 * JSON Schema generation for scene and project files.
 *
 * The generated schema is what gives an editor — and any LLM tool that reads
 * `$schema` — live autocomplete and inline errors while a scene file is being
 * written. It is built from the same component definitions the runtime uses, so
 * completion can never suggest a field the engine does not have.
 *
 *   sjl schema --out schemas/
 */

import { fieldToJSONSchema } from '../core/schema.js';
import { components as globalComponents } from '../core/component.js';
import { behaviors as globalBehaviors } from '../core/behavior.js';
import { ASSET_TYPES } from '../assets/assets.js';
import { VERSION } from '../version.js';

const SCHEMA_ID = 'https://sjl-engine.dev/schemas/scene.schema.json';

/**
 * @param {object} [options]
 * @param {import('../core/component.js').ComponentRegistry} [options.components]
 * @param {import('../core/behavior.js').BehaviorRegistry} [options.behaviors]
 */
export function sceneJSONSchema(options = {}) {
  const componentRegistry = options.components ?? globalComponents;
  const behaviorRegistry = options.behaviors ?? globalBehaviors;

  /** One property per component, so `components.Sprite.` completes correctly. */
  const componentProperties = {};
  for (const component of componentRegistry.all()) {
    if (component.runtime) continue;
    componentProperties[component.name] = component.toJSONSchema();
  }

  const behaviorVariants = behaviorRegistry.all().map((behavior) => ({
    type: 'object',
    properties: {
      type: { const: behavior.name, description: behavior.description },
      enabled: { type: 'boolean', default: true },
      props: propsSchema(behavior),
      ...propsInline(behavior),
    },
    required: ['type'],
    // The flat form puts props at the top level, so extra keys must be allowed.
    additionalProperties: true,
  }));

  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: SCHEMA_ID,
    title: `SJL Engine scene (v${VERSION})`,
    description:
      'A complete level: settings, assets, prefabs and an entity tree. ' +
      'Run `sjl validate` for checks JSON Schema cannot express, such as ' +
      'entity references resolving and animation clips existing.',
    type: 'object',
    properties: {
      $schema: { type: 'string' },
      name: { type: 'string', description: 'Scene name; shown in tooling' },
      settings: {
        type: 'object',
        properties: {
          gravity: {
            oneOf: [
              { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
              { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
            ],
            default: [0, -20],
            description: 'World units per second squared',
          },
          seed: {
            oneOf: [{ type: 'number' }, { type: 'string' }],
            description: 'Seeds the world RNG. Set it to make the run reproducible.',
          },
          timeScale: { type: 'number', default: 1 },
          physics: componentRegistry.get('PhysicsSettings')?.toJSONSchema() ?? { type: 'object' },
        },
        additionalProperties: true,
      },
      assets: {
        type: 'array',
        description: 'Assets this scene needs. Referenced by id from component fields.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique id; what component fields reference' },
            type: { type: 'string', enum: ASSET_TYPES, default: 'texture' },
            src: { type: 'string', description: 'Path relative to the project root' },
            width: { type: 'integer', description: 'Declared width; used in headless runs' },
            height: { type: 'integer' },
            frames: {
              type: 'object',
              description: 'Named atlas regions, in pixels',
              additionalProperties: {
                type: 'object',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  w: { type: 'number' },
                  h: { type: 'number' },
                },
                required: ['x', 'y', 'w', 'h'],
              },
            },
          },
          required: ['id'],
        },
      },
      prefabs: {
        type: 'object',
        description: 'Reusable entity templates, instanced with { "prefab": "Name" }',
        additionalProperties: { $ref: '#/definitions/entity' },
      },
      entities: {
        type: 'array',
        description: 'The scene\'s root entities',
        items: { $ref: '#/definitions/entity' },
      },
    },
    additionalProperties: false,
    definitions: {
      entity: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Stable id, unique in the scene. Entity-reference fields point at it.',
          },
          name: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          enabled: { type: 'boolean', default: true },
          prefab: { type: 'string', description: 'Name of a prefab to instance and override' },
          components: {
            type: 'object',
            properties: componentProperties,
            additionalProperties: false,
          },
          behaviors: {
            type: 'array',
            items: behaviorVariants.length
              ? { anyOf: behaviorVariants }
              : {
                  type: 'object',
                  properties: { type: { type: 'string' } },
                  required: ['type'],
                },
          },
          children: { type: 'array', items: { $ref: '#/definitions/entity' } },
        },
        additionalProperties: false,
      },
    },
  };
}

function propsSchema(behavior) {
  const properties = {};
  const required = [];
  for (const [name, field] of Object.entries(behavior.props)) {
    properties[name] = fieldSchema(field);
    if (field.required) required.push(name);
  }
  const schema = { type: 'object', properties, additionalProperties: false };
  if (required.length) schema.required = required;
  return schema;
}

/** The same props, hoisted to the top level for the flat authoring form. */
function propsInline(behavior) {
  const out = {};
  for (const [name, field] of Object.entries(behavior.props)) {
    out[name] = fieldSchema(field);
  }
  return out;
}

function fieldSchema(field) {
  // Reuse the component field converter; behaviors use the identical field type
  // vocabulary, so duplicating the mapping here would be a source of drift.
  return fieldToJSONSchema(field);
}

/** Schema for `sjl.config.json`. */
export function projectJSONSchema() {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://sjl-engine.dev/schemas/project.schema.json',
    title: `SJL Engine project (v${VERSION})`,
    type: 'object',
    properties: {
      name: { type: 'string' },
      scenes: {
        type: 'array',
        items: { type: 'string' },
        description: 'Scene files, relative to the project root. The first is the entry scene.',
      },
      scripts: {
        type: 'array',
        items: { type: 'string' },
        description:
          'ES modules imported before any scene loads. This is where defineBehavior and ' +
          'defineComponent calls belong.',
      },
      window: {
        type: 'object',
        properties: {
          width: { type: 'integer', default: 800 },
          height: { type: 'integer', default: 600 },
          title: { type: 'string' },
        },
      },
      input: {
        type: 'object',
        properties: {
          actions: {
            type: 'object',
            description: 'Action map. Game code reads action names, never key codes.',
            additionalProperties: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['button', 'axis'] },
                keys: { type: 'array', items: { type: 'string' } },
                positive: { type: 'array', items: { type: 'string' } },
                negative: { type: 'array', items: { type: 'string' } },
                gamepadAxis: { type: 'string' },
                deadZone: { type: 'number' },
                description: { type: 'string' },
              },
            },
          },
        },
      },
      seed: { oneOf: [{ type: 'number' }, { type: 'string' }] },
      renderer: { type: 'string', enum: ['auto', 'webgl2', 'canvas2d'], default: 'auto' },
    },
    additionalProperties: true,
  };
}
