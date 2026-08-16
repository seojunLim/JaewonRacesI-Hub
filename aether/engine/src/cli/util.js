/**
 * Shared CLI helpers: project discovery, scene enumeration, output formatting.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** ANSI colors, suppressed when stdout is not a TTY or NO_COLOR is set. */
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
export const c = {
  red: (s) => (useColor ? `[31m${s}[0m` : s),
  green: (s) => (useColor ? `[32m${s}[0m` : s),
  yellow: (s) => (useColor ? `[33m${s}[0m` : s),
  blue: (s) => (useColor ? `[34m${s}[0m` : s),
  dim: (s) => (useColor ? `[2m${s}[0m` : s),
  bold: (s) => (useColor ? `[1m${s}[0m` : s),
  enabled: useColor,
};

/** Resolve the project root from `--root`, defaulting to the cwd. */
export function resolveRoot(options) {
  return path.resolve(String(options.root ?? '.'));
}

/**
 * Read `sjl.config.json`, returning `null` when there is none.
 * Missing config is a normal state — `sjl validate scene.json` should work in
 * any directory.
 */
export async function readConfig(root) {
  try {
    const text = await readFile(path.join(root, 'sjl.config.json'), 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`sjl.config.json is not valid JSON: ${error.message}`);
  }
}

/**
 * Import a project's script modules so its components and behaviors register
 * before scenes referencing them are parsed.
 *
 * Failures are collected rather than thrown: a project with one broken script
 * should still get useful validation output for its scenes.
 *
 * @returns {Promise<Array<{script: string, error: string}>>}
 */
export async function loadProjectScripts(root, config) {
  const failures = [];
  for (const script of config?.scripts ?? []) {
    const file = path.isAbsolute(script) ? script : path.join(root, script);
    try {
      await import(pathToFileURL(file).href);
    } catch (error) {
      failures.push({ script, error: error.message });
    }
  }
  return failures;
}

/**
 * Every scene file in the project: the config's `scenes` list if there is one,
 * otherwise every `.json` under `scenes/` that looks like a scene.
 */
export async function findScenes(root, config) {
  if (config?.scenes?.length) {
    return config.scenes.map((s) => (path.isAbsolute(s) ? s : path.join(root, s)));
  }
  const candidates = [];
  for (const dir of ['scenes', 'assets/scenes', '.']) {
    const full = path.join(root, dir);
    try {
      const entries = await readdir(full);
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue;
        if (entry === 'package.json' || entry === 'sjl.config.json') continue;
        const file = path.join(full, entry);
        if ((await stat(file)).isFile() && (await looksLikeScene(file))) candidates.push(file);
      }
    } catch {
      // Directory does not exist; nothing to scan.
    }
    if (candidates.length) break;
  }
  return candidates;
}

async function looksLikeScene(file) {
  try {
    const document = JSON.parse(await readFile(file, 'utf8'));
    return Array.isArray(document?.entities) || typeof document?.prefabs === 'object';
  } catch {
    return false;
  }
}

/** Parse a scene file, surfacing the filename on a JSON syntax error. */
export async function readSceneFile(file) {
  const text = await readFile(file, 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`);
  }
}

/** `path.relative` from the cwd, for tidy output. */
export function rel(file) {
  const relative = path.relative(process.cwd(), file);
  return relative.startsWith('..') ? file : relative || '.';
}

/** Render an array of objects as an aligned table. */
export function table(rows, columns) {
  if (rows.length === 0) return '';
  const widths = columns.map((col) =>
    Math.max(col.header.length, ...rows.map((row) => String(row[col.key] ?? '').length)),
  );
  const line = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join('  ');
  return [
    c.bold(line(columns.map((col) => col.header))),
    c.dim(line(widths.map((w) => '-'.repeat(w)))),
    ...rows.map((row) => line(columns.map((col) => row[col.key] ?? ''))),
  ].join('\n');
}
