/**
 * `sjl run` — play a game headlessly and report what happened.
 *
 * This is the command that closes the loop for an agent. It runs the real
 * engine, at a fixed timestep, with a seeded RNG, and prints the resulting
 * world state — so "does my level work" is answerable from a shell, with no
 * browser and no human looking at a canvas.
 *
 *   sjl run --frames 180 --ascii
 *   sjl run --press jump@40 --press jump@70 --frames 120 --json
 *   sjl run --scene scenes/level-2.json --tree
 */

import path from 'node:path';
import { createHeadlessApp } from '../../runtime/headless.js';
import { readConfig, resolveRoot, findScenes, rel, c } from '../util.js';
import '../../index.js';

export async function run({ options }) {
  const root = resolveRoot(options);
  const config = await readConfig(root);

  const scene = await resolveSceneArg(options, root, config);
  const frames = Number(options.frames ?? 60);
  const dt = 1 / Number(options.fps ?? 60);

  const app = await createHeadlessApp({
    root,
    scene,
    scripts: config?.scripts ?? [],
    actions: config?.input?.actions,
    width: Number(options.width ?? config?.window?.width ?? 800),
    height: Number(options.height ?? config?.window?.height ?? 600),
    seed: options.seed ?? config?.seed,
    profiling: Boolean(options.profile),
  });

  const script = parseInputScript(options.press, options.release, options.axis);
  const warnings = [];
  const logs = [];

  // Capture everything the game and the engine print during the run.
  //
  // In `--json` mode this is not cosmetic: a single `console.log` from a
  // behavior would land in the middle of stdout and make the report unparseable
  // for whatever is reading it. Captured output goes into the report instead,
  // where it is still visible but cannot corrupt the JSON.
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const capture = (bucket, passthrough) => (...args) => {
    bucket.push(args.map(String).join(' '));
    if (!options.json) passthrough(...args);
  };
  console.warn = capture(warnings, original.warn);
  console.error = capture(warnings, original.error);
  console.log = capture(logs, original.log);
  console.info = capture(logs, original.info);

  try {
    for (let frame = 0; frame < frames; frame++) {
      for (const event of script.get(frame) ?? []) applyInputEvent(app, event);
      app.step(dt);
    }
  } finally {
    Object.assign(console, original);
  }

  const result = {
    ok: true,
    scene: app.currentScene?.name ?? null,
    frames,
    simulatedSeconds: Number((frames * dt).toFixed(4)),
    time: app.time.toJSON(),
    entityCount: app.world.entityCount,
    entities: app.world.debugDump().entities,
    warnings,
    logs,
    ...(options.profile ? { profile: app.scheduler.report() } : {}),
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    app.stop();
    return 0;
  }

  console.log(
    `${c.bold(result.scene ?? '(scene)')} — ${frames} frames ` +
      `(${result.simulatedSeconds}s, ${app.time.fixedStep} fixed steps)`,
  );
  console.log('');

  if (options.tree) {
    console.log(c.bold('Scene graph'));
    console.log(app.tree());
    console.log('');
  }

  if (options.ascii || options.topdown) {
    const frame = app.renderer.lastFrame;
    if (!frame) {
      console.log(c.yellow('No frame was rendered — is there an active Camera in the scene?'));
    } else {
      const width = Number(options.cols ?? 56);
      const height = Number(options.rows ?? 24);
      if (options.ascii) {
        console.log(c.bold(frame.view3d ? 'Final frame (camera view)' : 'Final frame'));
        console.log(frame.toAscii({ width, height }));
      }
      if (options.topdown) {
        if (!frame.view3d) {
          console.log(c.yellow('--topdown only applies to 3D scenes'));
        } else {
          console.log(c.bold('Top-down map (xz)'));
          console.log(frame.toAsciiTopDown({ width, height }));
        }
      }
      console.log(c.dim(`${frame.count} draw command(s)`));
    }
    console.log('');
  }

  if (!options.tree && !options.ascii && !options.topdown) {
    console.log(c.bold('Entities'));
    for (const entity of result.entities) {
      const transform = entity.components.Transform;
      const position = transform?.position
        ? ` at (${round(transform.position[0])}, ${round(transform.position[1])})`
        : '';
      console.log(`  ${entity.name}${position} {${Object.keys(entity.components).join(', ')}}`);
    }
    console.log('');
  }

  if (options.profile) {
    console.log(c.bold('System profile (avg ms)'));
    for (const entry of app.scheduler.report().slice(0, 10)) {
      console.log(`  ${entry.avgMs.toFixed(3).padStart(8)}  ${entry.name}`);
    }
    console.log('');
  }

  if (warnings.length) {
    console.log(c.yellow(`${warnings.length} warning(s) during the run`));
  }

  app.stop();
  return 0;
}

async function resolveSceneArg(options, root, config) {
  if (options.scene) {
    return path.isAbsolute(String(options.scene))
      ? String(options.scene)
      : path.join(root, String(options.scene));
  }
  const scenes = await findScenes(root, config);
  if (scenes.length === 0) {
    throw new Error(
      'No scene to run. Pass --scene <file>, or run from a project with sjl.config.json.',
    );
  }
  return scenes[0];
}

/**
 * Parse `--press action@frame` into a frame-indexed schedule.
 *
 * Scripted input is what makes a headless run reproducible end to end: the same
 * scene, the same seed and the same input schedule always produce the same
 * final state, so a run is a test.
 *
 * @returns {Map<number, Array<{kind: string, action: string, value?: number}>>}
 */
export function parseInputScript(press, release, axis) {
  const schedule = new Map();
  const add = (frame, event) => {
    if (!schedule.has(frame)) schedule.set(frame, []);
    schedule.get(frame).push(event);
  };

  for (const entry of toArray(press)) {
    const { action, frame, duration } = parseEntry(entry);
    add(frame, { kind: 'press', action });
    // `jump@30:5` holds for 5 frames, then releases — the shape a real press has.
    if (duration > 0) add(frame + duration, { kind: 'release', action });
  }
  for (const entry of toArray(release)) {
    const { action, frame } = parseEntry(entry);
    add(frame, { kind: 'release', action });
  }
  for (const entry of toArray(axis)) {
    // `moveX=1@0` — hold an axis at a value from a given frame.
    const [spec, frameText] = String(entry).split('@');
    const [action, valueText] = spec.split('=');
    add(Number(frameText ?? 0), { kind: 'axis', action, value: Number(valueText ?? 1) });
  }
  return schedule;
}

function parseEntry(entry) {
  const text = String(entry);
  const [action, rest] = text.split('@');
  const [frameText, durationText] = (rest ?? '0').split(':');
  return {
    action,
    frame: Number(frameText) || 0,
    duration: durationText ? Number(durationText) : 6,
  };
}

function applyInputEvent(app, event) {
  switch (event.kind) {
    case 'press':
      app.input.press(event.action);
      break;
    case 'release':
      app.input.release(event.action);
      break;
    case 'axis':
      app.input.setAxis(event.action, event.value);
      break;
  }
}

function toArray(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function round(n) {
  return Math.round(n * 100) / 100;
}
