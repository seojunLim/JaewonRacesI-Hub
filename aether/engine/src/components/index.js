/**
 * Registers every built-in component, 2D and 3D.
 *
 * Importing this module has the side effect of populating the global component
 * registry — that is why it is imported for its side effect from `src/index.js`
 * before any scene can be loaded.
 *
 * The 2D and 3D component sets are independent. An entity uses one or the
 * other; the systems for each never see the other's entities, so a scene can
 * hold a 3D world and a 2D HUD with no mode flag anywhere.
 */

export * from './transform.js';
export * from './rendering.js';
export * from './physics.js';
export * from './gameplay.js';

export * from './transform3d.js';
export * from './rendering3d.js';
export * from './physics3d.js';

import { components } from '../core/component.js';

/** Names of all built-in components, for docs and the editor's add menu. */
export function builtinComponentNames() {
  return components.names();
}

/** Component names that only make sense in a 3D scene. */
export const COMPONENTS_3D = [
  'Transform3D',
  'WorldTransform3D',
  'MeshRenderer',
  'Camera3D',
  'Light',
  'Skybox',
  'CameraOrbit',
  'Rigidbody3D',
  'BoxCollider3D',
  'SphereCollider',
  'Physics3DSettings',
  'CharacterController3D',
];

/** Component names that only make sense in a 2D scene. */
export const COMPONENTS_2D = [
  'Transform',
  'WorldTransform',
  'Sprite',
  'ShapeRenderer',
  'Text',
  'Camera',
  'CameraFollow',
  'TilemapRenderer',
  'ParticleEmitter',
  'Rigidbody',
  'BoxCollider',
  'CircleCollider',
  'PhysicsSettings',
];
