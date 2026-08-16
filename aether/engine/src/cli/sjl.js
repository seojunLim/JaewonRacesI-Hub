#!/usr/bin/env node
/**
 * `sjl` — the engine's command line.
 *
 * The commands are designed around what an automated caller needs, not just
 * what a human at a terminal needs:
 *
 *   - every command takes `--json` and prints a machine-readable result
 *   - every command exits non-zero on failure, with the reason on stderr
 *   - `validate` reports *all* problems at once, each with a suggestion
 *   - `run` executes a game headlessly and prints the resulting world state
 *
 * That combination means an agent can write a scene, check it, run it, and read
 * the outcome without a browser, a display, or a human in the loop.
 */

import process from 'node:process';
import { VERSION } from '../version.js';

const COMMANDS = {
  new: () => import('./commands/new.js'),
  dev: () => import('./commands/dev.js'),
  build: () => import('./commands/build.js'),
  validate: () => import('./commands/validate.js'),
  describe: () => import('./commands/describe.js'),
  schema: () => import('./commands/schema.js'),
  run: () => import('./commands/run.js'),
  doctor: () => import('./commands/doctor.js'),
};

const USAGE = `sjl ${VERSION} — an AI-native 2D game engine

USAGE
  sjl <command> [options]

COMMANDS
  new <dir>            Scaffold a project
                         --template blank|platformer|topdown|breakout|3d  (default: platformer)
  dev                  Serve the project with live reload
                         --root <dir>  --port <n>  --open
  build [out]          Produce a static, deployable build
                         --root <dir>  --minify
  validate [files...]  Check scene files; reports every problem with suggestions
                         --root <dir>  --json  --strict
  describe             Print the full engine API
                         --json  --markdown  --compact  --root <dir>
  schema               Emit JSON Schema for scene and project files
                         --out <dir>  --root <dir>
  run                  Run a game headlessly and print the result
                         --root <dir>  --scene <file>  --frames <n>  --seed <s>
                         --ascii  --topdown  --json  --tree  --press <action@frame>
  doctor               Check a project for problems

GLOBAL
  --help, -h           Show this help
  --version, -v        Show the version

EXAMPLES
  sjl new my-game --template platformer
  sjl new my-3d-game --template 3d   # a 3D game, same workflow
  sjl validate                       # check every scene in the project
  sjl describe --compact             # the API surface, small enough to paste in a prompt
  sjl run --frames 120 --ascii       # play 2 seconds and draw the result
  sjl run --press jump@30 --frames 90 --json
`;

/** @param {string[]} argv */
export async function main(argv = process.argv.slice(2)) {
  const { command, options, positional } = parseArgs(argv);

  if (options.version || options.v) {
    console.log(VERSION);
    return 0;
  }
  if (!command || options.help || options.h) {
    // `sjl <cmd> --help` should show that command's help, which each module
    // handles; only a bare `--help` prints the overview.
    if (!command || !COMMANDS[command]) {
      console.log(USAGE);
      return command && !COMMANDS[command] ? 1 : 0;
    }
  }

  const loader = COMMANDS[command];
  if (!loader) {
    console.error(`Unknown command "${command}".\n`);
    console.error(USAGE);
    return 1;
  }

  try {
    const module = await loader();
    const code = await module.run({ options, positional, argv });
    return typeof code === 'number' ? code : 0;
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: error.message }, null, 2));
    } else {
      console.error(`\nsjl ${command}: ${error.message}`);
      if (options.debug) console.error(error.stack);
    }
    return 1;
  }
}

/**
 * A small argv parser.
 *
 * Supports `--flag`, `--key value`, `--key=value`, `-abc` shorthand bundles and
 * `--no-key`. Repeating a key collects it into an array, which is what makes
 * `--press jump@10 --press fire@20` work.
 */
export function parseArgs(argv) {
  const options = {};
  const positional = [];
  let command = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      if (body.startsWith('no-')) {
        options[camel(body.slice(3))] = false;
        continue;
      }
      const eq = body.indexOf('=');
      if (eq >= 0) {
        assign(options, camel(body.slice(0, eq)), body.slice(eq + 1));
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        assign(options, camel(body), next);
        i++;
      } else {
        options[camel(body)] = true;
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      for (const ch of arg.slice(1)) options[ch] = true;
      continue;
    }
    if (command === null) command = arg;
    else positional.push(arg);
  }

  return { command, options, positional };
}

function assign(options, key, value) {
  const coerced = coerceValue(value);
  if (key in options) {
    options[key] = Array.isArray(options[key]) ? [...options[key], coerced] : [options[key], coerced];
  } else {
    options[key] = coerced;
  }
}

function coerceValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== '' && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

function camel(text) {
  return text.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

// Only run when invoked directly, so the module can also be imported by tests.
const invokedDirectly =
  process.argv[1] && (process.argv[1].endsWith('sjl.js') || process.argv[1].endsWith('sjl'));

if (invokedDirectly) {
  main().then((code) => {
    process.exitCode = code;
  });
}
