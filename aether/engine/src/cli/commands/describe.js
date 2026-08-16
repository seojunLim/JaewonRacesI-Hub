/**
 * `sjl describe` — print the engine's API surface.
 *
 * Three shapes, for three consumers:
 *   (default)    Markdown — readable, and what you paste into a prompt
 *   --json       the full manifest, for tools
 *   --compact    names and field types only, when context budget is tight
 *
 * When run inside a project it loads that project's scripts first, so the
 * output includes the game's own components and behaviors alongside the
 * built-in ones. That is the difference between documentation and a manifest:
 * this describes the engine *as configured right now*.
 */

import { describeEngine, describeMarkdown, describeCompact } from '../../tools/describe.js';
import { readConfig, resolveRoot, loadProjectScripts, c } from '../util.js';
import '../../index.js';

export async function run({ options }) {
  const root = resolveRoot(options);
  const config = await readConfig(root);

  const scriptFailures = config ? await loadProjectScripts(root, config) : [];
  if (scriptFailures.length && !options.json) {
    for (const failure of scriptFailures) {
      console.error(c.yellow(`warning: could not load "${failure.script}": ${failure.error}`));
    }
  }

  if (options.json) {
    console.log(JSON.stringify(describeEngine(), null, 2));
    return 0;
  }
  if (options.compact) {
    console.log(describeCompact());
    return 0;
  }

  // Filtered views: `sjl describe --components Sprite,Rigidbody`
  if (typeof options.components === 'string' || typeof options.behaviors === 'string') {
    return printFiltered(options);
  }

  console.log(describeMarkdown());
  return 0;
}

function printFiltered(options) {
  const manifest = describeEngine();

  if (typeof options.components === 'string') {
    const wanted = options.components.split(',').map((s) => s.trim());
    for (const name of wanted) {
      const component = manifest.components.find((x) => x.name === name);
      if (!component) {
        console.error(`Unknown component "${name}"`);
        continue;
      }
      console.log(c.bold(component.name));
      if (component.description) console.log(`  ${component.description}`);
      for (const line of component.signature) console.log(`  ${line}`);
      console.log('');
    }
  }

  if (typeof options.behaviors === 'string') {
    const wanted = options.behaviors.split(',').map((s) => s.trim());
    for (const name of wanted) {
      const behavior = manifest.behaviors.find((x) => x.name === name);
      if (!behavior) {
        console.error(`Unknown behavior "${name}"`);
        continue;
      }
      console.log(c.bold(behavior.name));
      if (behavior.description) console.log(`  ${behavior.description}`);
      console.log(`  hooks: ${behavior.hooks.join(', ') || '(none)'}`);
      for (const line of behavior.signature) console.log(`  ${line}`);
      console.log('');
    }
  }
  return 0;
}
