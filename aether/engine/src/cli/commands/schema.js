/**
 * `sjl schema` — emit JSON Schema for scene and project files.
 *
 * Point a scene file's `$schema` at the generated file and any schema-aware
 * editor gets completion and inline errors for every component field, generated
 * from the same definitions the runtime uses.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sceneJSONSchema, projectJSONSchema } from '../../tools/jsonschema.js';
import { readConfig, resolveRoot, loadProjectScripts, rel, c } from '../util.js';
import '../../index.js';

export async function run({ options }) {
  const root = resolveRoot(options);
  const config = await readConfig(root);
  if (config) await loadProjectScripts(root, config);

  const scene = sceneJSONSchema();
  const project = projectJSONSchema();

  if (!options.out) {
    console.log(JSON.stringify(options.project ? project : scene, null, 2));
    return 0;
  }

  const outDir = path.isAbsolute(String(options.out))
    ? String(options.out)
    : path.join(root, String(options.out));
  await mkdir(outDir, { recursive: true });

  const sceneFile = path.join(outDir, 'scene.schema.json');
  const projectFile = path.join(outDir, 'project.schema.json');
  await writeFile(sceneFile, `${JSON.stringify(scene, null, 2)}\n`);
  await writeFile(projectFile, `${JSON.stringify(project, null, 2)}\n`);

  console.log(`${c.green('wrote')} ${rel(sceneFile)}`);
  console.log(`${c.green('wrote')} ${rel(projectFile)}`);
  console.log('');
  console.log(c.dim('Add this to the top of a scene file for editor completion:'));
  console.log(c.dim(`  "$schema": "${path.relative(path.join(root, 'scenes'), sceneFile)}"`));
  return 0;
}
