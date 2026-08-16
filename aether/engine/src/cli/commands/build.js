/**
 * `sjl build` — produce a static, deployable directory.
 *
 * There is no bundling step because there is nothing to bundle: the engine is
 * plain ES modules and every browser that can run a WebGL2 game can load them
 * natively. The build copies the project, copies the engine source next to it,
 * validates every scene, and stops if anything is broken — shipping a scene
 * that fails validation is never what you wanted.
 */

import { cp, mkdir, readdir, rm, stat, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateScene } from '../../scene/validate.js';
import { readConfig, resolveRoot, findScenes, readSceneFile, loadProjectScripts, rel, c } from '../util.js';
import '../../index.js';

const ENGINE_ROOT = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));

const SKIP = new Set(['node_modules', '.git', 'dist', 'engine', '.DS_Store']);

export async function run({ options, positional }) {
  const root = resolveRoot(options);
  const outDir = path.resolve(positional[0] ?? options.out ?? path.join(root, 'dist'));
  const config = await readConfig(root);

  if (config) await loadProjectScripts(root, config);

  // Validate before copying anything: a broken build should not overwrite a
  // working one.
  const scenes = await findScenes(root, config);
  let errors = 0;
  for (const file of scenes) {
    const issues = validateScene(await readSceneFile(file)).filter((i) => i.severity !== 'warning');
    if (issues.length === 0) continue;
    errors += issues.length;
    console.error(`${c.red('fail')}  ${rel(file)}`);
    for (const issue of issues) console.error(`        ${issue.path}: ${issue.message}`);
  }
  if (errors > 0 && !options.force) {
    console.error('');
    console.error(c.red(`${errors} scene error(s). Fix them, or pass --force to build anyway.`));
    return 1;
  }

  if (options.clean !== false) await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const copied = await copyProject(root, outDir);

  // The engine goes in as source, matching the `./engine/...` import paths the
  // templates use.
  await cp(path.join(ENGINE_ROOT, 'src'), path.join(outDir, 'engine', 'src'), { recursive: true });

  await writeFile(
    path.join(outDir, 'build.json'),
    `${JSON.stringify(
      {
        name: config?.name ?? path.basename(root),
        builtAt: new Date().toISOString(),
        scenes: scenes.map((s) => path.relative(root, s)),
        files: copied,
      },
      null,
      2,
    )}\n`,
  );

  const size = await directorySize(outDir);
  console.log('');
  console.log(`${c.green('Built')} ${rel(outDir)}  ${c.dim(`${copied} file(s), ${formatBytes(size)}`)}`);
  console.log('');
  console.log(c.dim('Serve it with any static file server, for example:'));
  console.log(c.dim(`  npx --yes serve ${rel(outDir)}`));
  console.log('');
  return 0;
}

async function copyProject(root, outDir) {
  let count = 0;

  const walk = async (dir, relative) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const from = path.join(dir, entry.name);
      const to = path.join(outDir, relative, entry.name);

      if (entry.isDirectory()) {
        await mkdir(to, { recursive: true });
        await walk(from, path.join(relative, entry.name));
      } else if (entry.isSymbolicLink()) {
        // Resolve rather than copy the link, so the build stands alone.
        const info = await stat(from).catch(() => null);
        if (info?.isDirectory()) {
          await cp(from, to, { recursive: true, dereference: true });
        } else if (info) {
          await cp(from, to, { dereference: true });
          count++;
        }
      } else {
        await cp(from, to);
        count++;
      }
    }
  };

  await walk(root, '');
  return count;
}

async function directorySize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await directorySize(full);
    else total += (await stat(full)).size;
  }
  return total;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
