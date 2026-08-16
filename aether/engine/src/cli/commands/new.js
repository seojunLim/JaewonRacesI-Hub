/**
 * `sjl new` — scaffold a project.
 *
 * The generated project links the engine in at `engine/` (a symlink when the
 * platform allows it, a copy otherwise) so `index.html` can import it as a
 * relative path with no bundler, no install step and no network. Open the file
 * and the game runs.
 */

import { mkdir, writeFile, symlink, cp, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTemplate, TEMPLATE_NAMES } from '../templates.js';
import { sceneJSONSchema, projectJSONSchema } from '../../tools/jsonschema.js';
import { rel, c } from '../util.js';
import '../../index.js';

const ENGINE_ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

export async function run({ options, positional }) {
  const target = positional[0];
  if (!target) {
    console.error('Usage: sjl new <dir> [--template blank|platformer|topdown|breakout]');
    return 1;
  }

  const dir = path.resolve(target);
  const name = options.name ? String(options.name) : path.basename(dir);
  const template = String(options.template ?? 'platformer');

  if (!TEMPLATE_NAMES.includes(template)) {
    console.error(`Unknown template "${template}". Available: ${TEMPLATE_NAMES.join(', ')}`);
    return 1;
  }

  if (await exists(dir)) {
    if (!options.force) {
      const entries = await import('node:fs/promises').then((fs) => fs.readdir(dir));
      if (entries.length > 0) {
        console.error(
          `${rel(dir)} already exists and is not empty. Pass --force to write into it anyway.`,
        );
        return 1;
      }
    }
  }

  const files = renderTemplate(template, name);

  // Schemas are generated rather than copied, so a project's completion data
  // always matches the engine version it was created with.
  files['schemas/scene.schema.json'] = `${JSON.stringify(sceneJSONSchema(), null, 2)}\n`;
  files['schemas/project.schema.json'] = `${JSON.stringify(projectJSONSchema(), null, 2)}\n`;

  const written = [];
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(dir, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
    written.push(relative);
  }

  const linkMode = await linkEngine(dir);

  console.log('');
  console.log(`${c.green('Created')} ${c.bold(name)} in ${rel(dir)}  ${c.dim(`(${template} template)`)}`);
  console.log('');
  for (const file of written.sort()) console.log(c.dim(`  ${file}`));
  console.log(c.dim(`  engine/ ${linkMode === 'symlink' ? '(symlinked)' : '(copied)'}`));
  console.log('');
  console.log(c.bold('Next steps'));
  console.log(`  cd ${rel(dir)}`);
  console.log('  sjl dev                    # open it in a browser with live reload');
  console.log('  sjl run --frames 180 --ascii   # or play it headlessly, right now');
  console.log('  sjl describe --compact     # the API, for you or for an agent');
  console.log('');

  return 0;
}

/**
 * Make the engine importable from the project as `./engine`.
 *
 * A symlink keeps the project in sync with engine edits, which is what you want
 * while developing the engine itself. Windows without developer mode cannot
 * create one, so fall back to a copy rather than failing.
 *
 * @returns {Promise<'symlink'|'copy'>}
 */
async function linkEngine(dir) {
  const target = path.join(dir, 'engine');
  if (await exists(target)) return 'symlink';

  try {
    await symlink(ENGINE_ROOT, target, 'dir');
    return 'symlink';
  } catch {
    await mkdir(target, { recursive: true });
    await cp(path.join(ENGINE_ROOT, 'src'), path.join(target, 'src'), { recursive: true });
    await cp(path.join(ENGINE_ROOT, 'package.json'), path.join(target, 'package.json'));
    return 'copy';
  }
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
