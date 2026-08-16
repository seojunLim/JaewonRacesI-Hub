/**
 * CameraOrbitSystem — third-person and inspection cameras.
 *
 * Kept as a system rather than a behavior because it must run after everything
 * else has finished moving this frame, and because "orbit a target" is the same
 * code in every 3D project.
 */

import { Phase, Order, defineSystem } from '../core/system.js';
import { damp, clamp, DEG2RAD } from '../math/scalar.js';
import { INPUT_RESOURCE } from './input.js';

export const CameraOrbitSystem = defineSystem({
  name: 'CameraOrbitSystem',
  phase: Phase.LATE_UPDATE,
  order: Order.LATE,
  description:
    'Orbits a Camera3D around its target at a fixed distance, optionally driven by the ' +
    'mouse. Runs late so it sees the final position of whatever it is tracking.',
  reads: ['CameraOrbit', 'Transform3D'],
  writes: ['Transform3D'],
  update({ world, dt }) {
    const store = world.stores.get('CameraOrbit');
    if (!store || store.size === 0) return;

    const input = world.getResource(INPUT_RESOURCE);

    for (const [entity, orbit, transform] of world.each('CameraOrbit', 'Transform3D')) {
      if (!orbit.target) continue;
      const target = world.findById(orbit.target) ?? world.findByName(orbit.target);
      if (!target?.alive) continue;

      const targetTransform = target.get('WorldTransform3D') ?? target.get('Transform3D');
      if (!targetTransform) continue;
      const focus = targetTransform.position;

      if (orbit.mouseControl && input) {
        // Dragging with the left button orbits; the wheel zooms. Deliberately
        // not a pointer-lock camera — that belongs in FirstPersonController,
        // where the game decides when to capture the cursor.
        if (input.mouseButton(0)) {
          orbit.yaw -= input.mouse.deltaX * orbit.sensitivity;
          orbit.pitch = clamp(orbit.pitch + input.mouse.deltaY * orbit.sensitivity, -89, 89);
        }
        if (input.mouse.wheel !== 0) {
          orbit.distance = clamp(
            orbit.distance + input.mouse.wheel * orbit.zoomSpeed,
            orbit.minDistance,
            orbit.maxDistance,
          );
        }
      }

      const yaw = orbit.yaw * DEG2RAD;
      const pitch = orbit.pitch * DEG2RAD;
      const horizontal = Math.cos(pitch) * orbit.distance;

      const desiredX = focus.x + orbit.targetOffset.x + Math.sin(yaw) * horizontal;
      const desiredY = focus.y + orbit.targetOffset.y + Math.sin(pitch) * orbit.distance;
      const desiredZ = focus.z + orbit.targetOffset.z + Math.cos(yaw) * horizontal;

      if (orbit.halfLife > 0) {
        transform.position.x = damp(transform.position.x, desiredX, orbit.halfLife, dt);
        transform.position.y = damp(transform.position.y, desiredY, orbit.halfLife, dt);
        transform.position.z = damp(transform.position.z, desiredZ, orbit.halfLife, dt);
      } else {
        transform.position.x = desiredX;
        transform.position.y = desiredY;
        transform.position.z = desiredZ;
      }

      // Aim at the focus point. Written directly as Euler angles rather than
      // going through lookRotation, because yaw and pitch are already known and
      // this keeps the camera's rotation continuous through the poles.
      const dx = focus.x + orbit.targetOffset.x - transform.position.x;
      const dy = focus.y + orbit.targetOffset.y - transform.position.y;
      const dz = focus.z + orbit.targetOffset.z - transform.position.z;
      const flat = Math.hypot(dx, dz);

      transform.rotation.y = Math.atan2(-dx, -dz) / DEG2RAD;
      transform.rotation.x = Math.atan2(dy, flat) / DEG2RAD;
      transform.rotation.z = 0;
    }
  },
});
