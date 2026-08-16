/**
 * `sjl validate` — check scene files.
 *
 * The most important command in the toolchain for agent-driven work. It answers
 * "is this scene actually correct" before anything runs, and it answers it
 * completely: every problem in every file, each with a suggested fix, in one
 * pass. With `--json`, the output is a structured report a tool can act on.
 */

import { validateScene } from '../../scene/validate.js';
import { readConfig, resolveRoot, findScenes, readSceneFile, loadProjectScripts, rel, c } from '../util.js';
import '../../index.js';

export async function run({ options, positional }) {
  const root = resolveRoot(options);
  const config = await readConfig(root);

  // Load the project's own behaviors and components first, so references to
  // them validate as errors instead of being downgraded to "not registered".
  const scriptFailures = config ? await loadProjectScripts(root, config) : [];

  const files = positional.length
    ? positional.map((f) => (f.startsWith('/') ? f : `${process.cwd()}/${f}`))
    : await findScenes(root, config);

  if (files.length === 0) {
    const message =
      'No scene files found. Pass paths explicitly (`sjl validate scenes/level.json`) ' +
      'or run from a project directory containing sjl.config.json.';
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: message, files: [] }, null, 2));
    } else {
      console.error(message);
    }
    return 1;
  }

  const results = [];
  let errorCount = 0;
  let warningCount = 0;

  for (const file of files) {
    let issues;
    try {
      const document = await readSceneFile(file);
      issues = validateScene(document, {
        // With project scripts loaded, an unregistered behavior really is an
        // error rather than "we could not check it".
        checkBehaviors: true,
      });
    } catch (error) {
      issues = [{ path: '', message: error.message, severity: 'error' }];
    }

    const errors = issues.filter((i) => i.severity !== 'warning');
    const warnings = issues.filter((i) => i.severity === 'warning');
    errorCount += errors.length;
    warningCount += warnings.length;

    results.push({
      file: rel(file),
      ok: errors.length === 0,
      errors: errors.length,
      warnings: warnings.length,
      issues,
    });
  }

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          ok: errorCount === 0,
          files: results.length,
          errors: errorCount,
          warnings: warningCount,
          scriptFailures,
          results,
        },
        null,
        2,
      ),
    );
    return errorCount === 0 ? 0 : 1;
  }

  for (const failure of scriptFailures) {
    console.error(
      c.yellow(`warning`) +
        ` could not load script "${failure.script}": ${failure.error}\n` +
        c.dim('    Behaviors it defines cannot be checked.'),
    );
  }

  for (const result of results) {
    const shown = options.strict ? result.issues : result.issues.filter((i) => i.severity !== 'warning' || options.warnings !== false);
    if (result.ok && shown.length === 0) {
      console.log(`${c.green('ok')}  ${result.file}`);
      continue;
    }
    const label = result.ok ? c.yellow('warn') : c.red('fail');
    console.log(`${label}  ${result.file}`);
    for (const issue of shown) {
      const tag = issue.severity === 'warning' ? c.yellow('warning') : c.red('error');
      console.log(`      ${tag} ${c.bold(issue.path || '<root>')}`);
      console.log(`        ${issue.message}`);
      if (issue.suggestion) console.log(c.dim(`        hint: ${issue.suggestion}`));
    }
  }

  console.log('');
  const summary =
    `${results.length} file(s), ` +
    `${errorCount} error(s), ${warningCount} warning(s)`;
  console.log(errorCount === 0 ? c.green(summary) : c.red(summary));

  // `--strict` promotes warnings to failures, for CI.
  if (options.strict && warningCount > 0) return 1;
  return errorCount === 0 ? 0 : 1;
}
