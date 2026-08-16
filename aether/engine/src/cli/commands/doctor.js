/**
 * `sjl doctor` — check a project for the problems that make a game silently
 * not work.
 *
 * Validation catches malformed scenes. Doctor catches the level above that: a
 * scene with no camera (renders nothing, no error), assets referenced but not
 * on disk, scripts listed in config that fail to import, entities with a
 * collider but no rigidbody where one was clearly meant. Each of these produces
 * a game that loads and does nothing, which is the hardest failure to debug
 * from the outside.
 */

import { access } from 'node:fs/promises';
import path from 'node:path';
import { validateScene } from '../../scene/validate.js';
import { readConfig, resolveRoot, findScenes, readSceneFile, loadProjectScripts, rel, c } from '../util.js';
import '../../index.js';

export async function run({ options }) {
  const root = resolveRoot(options);
  const config = await readConfig(root);
  /** @type {Array<{level: string, where: string, message: string, fix?: string}>} */
  const findings = [];

  if (!config) {
    findings.push({
      level: 'warning',
      where: 'sjl.config.json',
      message: 'No project config found',
      fix: 'Run `sjl new .` to scaffold one, or pass --root to point at the project.',
    });
  }

  const scriptFailures = config ? await loadProjectScripts(root, config) : [];
  for (const failure of scriptFailures) {
    findings.push({
      level: 'error',
      where: failure.script,
      message: `Script failed to import: ${failure.error}`,
      fix: 'Behaviors defined in this file will be missing at runtime.',
    });
  }

  const scenes = await findScenes(root, config);
  if (scenes.length === 0) {
    findings.push({
      level: 'error',
      where: root,
      message: 'No scene files found',
      fix: 'Create scenes/main.json, or list scenes in sjl.config.json.',
    });
  }

  for (const file of scenes) {
    const where = rel(file);
    let document;
    try {
      document = await readSceneFile(file);
    } catch (error) {
      findings.push({ level: 'error', where, message: error.message });
      continue;
    }

    for (const issue of validateScene(document)) {
      findings.push({
        level: issue.severity,
        where: `${where} ${issue.path}`,
        message: issue.message,
        fix: issue.suggestion,
      });
    }

    const entities = flatten(document.entities ?? []);

    // A 3D scene is one that has any 3D component; the checks below differ.
    const is3D = entities.some(
      (e) => e.components?.Transform3D || e.components?.MeshRenderer || e.components?.Camera3D,
    );

    // A scene with no camera renders a blank screen and reports nothing wrong.
    const hasCamera = entities.some((e) => e.components?.Camera || e.components?.Camera3D);
    if (!hasCamera) {
      findings.push({
        level: 'error',
        where,
        message: 'No entity has a Camera or Camera3D component, so nothing will be drawn',
        fix: is3D
          ? 'Add: { "name": "Camera", "components": { "Transform3D": { "position": [0, 4, 10] }, "Camera3D": {} } }'
          : 'Add: { "name": "Camera", "components": { "Transform": {}, "Camera": { "size": 6 } } }',
      });
    }

    for (const [component, label] of [['Camera', '2D'], ['Camera3D', '3D']]) {
      const active = entities.filter(
        (e) => e.components?.[component] && e.components[component].active !== false,
      ).length;
      if (active > 1) {
        findings.push({
          level: 'warning',
          where,
          message: `${active} active ${label} cameras; the highest priority one wins`,
          fix: 'Set `active: false` on the others, or give them distinct `priority` values.',
        });
      }
    }

    // A 3D scene with no light renders every mesh black, with no error anywhere.
    if (is3D) {
      const lights = entities.filter((e) => e.components?.Light);
      if (lights.length === 0) {
        findings.push({
          level: 'error',
          where,
          message: 'A 3D scene with no Light renders every mesh black',
          fix: 'Add a directional light and an ambient fill: ' +
            '{ "components": { "Transform3D": { "rotation": [-45, 35, 0] }, "Light": { "type": "directional" } } }',
        });
      } else if (!lights.some((e) => e.components.Light.type === 'ambient')) {
        findings.push({
          level: 'warning',
          where,
          message: 'No ambient light; surfaces facing away from every light will be fully black',
          fix: 'Add: { "components": { "Transform3D": {}, "Light": { "type": "ambient", "intensity": 0.3 } } }',
        });
      }

      // Screen-space HUD text is a 2D component, and the 2D pass needs a 2D camera.
      const screenText = entities.filter((e) => e.components?.Text?.screenSpace);
      const has2DCamera = entities.some((e) => e.components?.Camera);
      if (screenText.length > 0 && !has2DCamera) {
        findings.push({
          level: 'error',
          where,
          message:
            'Screen-space Text is drawn by the 2D pass, which needs an entity with a 2D Camera',
          fix: 'Add: { "components": { "Transform": {}, "Camera": { "background": "#00000000" } } }',
        });
      }
    }

    // Anything drawable but off-camera-by-default is worth flagging early.
    const drawables = entities.filter(
      (e) =>
        e.components?.Sprite ||
        e.components?.ShapeRenderer ||
        e.components?.Text ||
        e.components?.MeshRenderer,
    );
    if (drawables.length === 0 && entities.length > 1) {
      findings.push({
        level: 'warning',
        where,
        message: 'No entity has a renderer component, so the scene will appear empty',
      });
    }

    for (const entity of entities) {
      const name = entity.name ?? entity.id ?? '(unnamed)';
      const components = entity.components ?? {};

      if (components.Rigidbody && !components.BoxCollider && !components.CircleCollider && !entity.prefab) {
        findings.push({
          level: 'warning',
          where: `${where} ${name}`,
          message: 'Has a Rigidbody but no collider, so it will fall through everything',
          fix: 'Add a BoxCollider or CircleCollider.',
        });
      }
      if (components.Rigidbody3D && !components.BoxCollider3D && !components.SphereCollider && !entity.prefab) {
        findings.push({
          level: 'warning',
          where: `${where} ${name}`,
          message: 'Has a Rigidbody3D but no collider, so it will fall through everything',
          fix: 'Add a BoxCollider3D or SphereCollider.',
        });
      }
      if (components.MeshRenderer && !components.Transform3D && !entity.prefab) {
        findings.push({
          level: 'error',
          where: `${where} ${name}`,
          message: 'Has a MeshRenderer but no Transform3D, so it has no position in the 3D world',
        });
      }
      if (components.SpriteAnimator && !components.Sprite && !entity.prefab) {
        findings.push({
          level: 'error',
          where: `${where} ${name}`,
          message: 'Has a SpriteAnimator but no Sprite to animate',
        });
      }
      if (components.Sprite?.texture && !components.Sprite.size && !entity.prefab) {
        findings.push({
          level: 'warning',
          where: `${where} ${name}`,
          message: 'Sprite has a texture but no explicit size; it will draw at 1x1 world units',
          fix: 'Set `size` to the sprite\'s intended world size.',
        });
      }
    }

    // Assets declared but missing on disk.
    for (const asset of document.assets ?? []) {
      if (!asset?.src || asset.src === '<inline>') continue;
      const file = path.isAbsolute(asset.src) ? asset.src : path.join(root, asset.src);
      try {
        await access(file);
      } catch {
        findings.push({
          level: 'error',
          where: `${where} assets.${asset.id}`,
          message: `File not found: ${asset.src}`,
          fix: `Expected it at ${rel(file)}`,
        });
      }
    }
  }

  const errors = findings.filter((f) => f.level === 'error');
  const warnings = findings.filter((f) => f.level !== 'error');

  if (options.json) {
    console.log(
      JSON.stringify(
        { ok: errors.length === 0, root, scenes: scenes.map(rel), errors: errors.length, warnings: warnings.length, findings },
        null,
        2,
      ),
    );
    return errors.length === 0 ? 0 : 1;
  }

  console.log(c.bold(`sjl doctor — ${rel(root)}`));
  console.log('');
  if (findings.length === 0) {
    console.log(c.green('No problems found.'));
    return 0;
  }

  for (const finding of findings) {
    const tag = finding.level === 'error' ? c.red('error  ') : c.yellow('warning');
    console.log(`${tag} ${c.bold(finding.where)}`);
    console.log(`        ${finding.message}`);
    if (finding.fix) console.log(c.dim(`        fix: ${finding.fix}`));
  }
  console.log('');
  const summary = `${errors.length} error(s), ${warnings.length} warning(s)`;
  console.log(errors.length === 0 ? c.yellow(summary) : c.red(summary));

  return errors.length === 0 ? 0 : 1;
}

/** Flatten an entity tree into a list, including children. */
function flatten(nodes, out = []) {
  for (const node of nodes) {
    out.push(node);
    if (node.children) flatten(node.children, out);
  }
  return out;
}
