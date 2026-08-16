/**
 * Input systems.
 *
 * Two bookends around the frame: one samples the action map before anything
 * runs, one clears per-frame flags after everything has run. Splitting them is
 * what guarantees that a `pressed('jump')` check in a late system sees the same
 * answer as one in an early system.
 */

import { Phase, Order, defineSystem } from '../core/system.js';
import { computeView, screenToWorld } from '../render/renderer.js';
import { activeCamera, RENDERER_RESOURCE } from './render.js';

export const INPUT_RESOURCE = 'input';

/** @param {import('../core/world.js').World} world @returns {import('../input/input.js').Input} */
export function getInput(world) {
  return world.requireResource(INPUT_RESOURCE);
}

export const InputSystem = defineSystem({
  name: 'InputSystem',
  phase: Phase.PRE_UPDATE,
  order: Order.FIRST,
  description:
    'Samples the action map and projects the mouse position into world space. ' +
    'Runs before everything else, so the whole frame sees one consistent input state.',
  update({ world }) {
    const input = world.getResource(INPUT_RESOURCE);
    if (!input) return;
    input.beginFrame();

    // Project the cursor into the world so behaviors can use `mouse.worldX/Y`
    // directly — aiming, dragging and click-to-move all need it, and doing the
    // projection per-behavior is both repetitive and easy to get wrong.
    const renderer = world.getResource(RENDERER_RESOURCE);
    const cam = activeCamera(world);
    if (renderer && cam) {
      const view = computeView(cam.camera, cam.transform, renderer.width, renderer.height);
      const p = screenToWorld(view, input.mouse.x, input.mouse.y);
      input.mouse.worldX = p.x;
      input.mouse.worldY = p.y;
    }
  },
});

export const InputEndFrameSystem = defineSystem({
  name: 'InputEndFrameSystem',
  phase: Phase.POST_RENDER,
  order: Order.LAST,
  description: 'Clears per-frame input flags after every system has had a chance to read them.',
  update({ world }) {
    world.getResource(INPUT_RESOURCE)?.endFrame();
  },
});
