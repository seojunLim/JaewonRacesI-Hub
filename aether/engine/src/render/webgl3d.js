/**
 * WebGL2 3D backend.
 *
 * A forward renderer: one draw call per mesh instance, Blinn-Phong shading with
 * up to `MAX_LIGHTS` lights, optional albedo texture, exponential distance fog,
 * and a gradient skybox.
 *
 * It **extends** the 2D renderer rather than replacing it. That is the whole
 * trick behind 2D-HUD-over-3D-world: both passes share one canvas, one GL
 * context and one sprite batcher, so a scene can hold a 3D world and a 2D HUD
 * with no compositing layer and no second canvas. The 3D pass runs with depth
 * testing on; the 2D pass runs with it off, afterwards, and therefore always
 * draws on top.
 *
 * No deferred pass, no shadow maps, no PBR. Those are where a 3D renderer's
 * complexity budget goes, and none of them change whether an agent can build a
 * game — which is what this engine optimizes for.
 */

import { WebGL2Renderer } from './webgl2.js';
import { getPrimitive, FLOATS_PER_VERTEX } from './mesh.js';
import * as Mat4 from '../math/mat4.js';

/** Raising this costs a uniform slot per light and a branch per fragment. */
export const MAX_LIGHTS = 8;

const MESH_VERTEX_SHADER = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec2 aTexCoord;

uniform mat4 uModel;
uniform mat4 uViewProjection;
uniform mat3 uNormalMatrix;

out vec3 vWorldPosition;
out vec3 vNormal;
out vec2 vTexCoord;

void main() {
  vec4 worldPosition = uModel * vec4(aPosition, 1.0);
  vWorldPosition = worldPosition.xyz;
  vNormal = uNormalMatrix * aNormal;
  vTexCoord = aTexCoord;
  gl_Position = uViewProjection * worldPosition;
}`;

const MESH_FRAGMENT_SHADER = `#version 300 es
precision highp float;

const int MAX_LIGHTS = ${MAX_LIGHTS};

in vec3 vWorldPosition;
in vec3 vNormal;
in vec2 vTexCoord;

uniform vec4 uBaseColor;
uniform float uUseTexture;
uniform sampler2D uTexture;
uniform float uShininess;
uniform float uEmissive;
uniform vec3 uCameraPosition;

// 0 = unused, 1 = directional, 2 = point, 3 = ambient
uniform int   uLightType[MAX_LIGHTS];
uniform vec3  uLightVector[MAX_LIGHTS];   // direction for directional, position for point
uniform vec3  uLightColor[MAX_LIGHTS];    // already multiplied by intensity
uniform float uLightRange[MAX_LIGHTS];
uniform int   uLightCount;

uniform vec3  uFogColor;
uniform float uFogDensity;

out vec4 fragColor;

void main() {
  vec4 albedo = uBaseColor;
  if (uUseTexture > 0.5) albedo *= texture(uTexture, vTexCoord);
  if (albedo.a < 0.003) discard;

  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(uCameraPosition - vWorldPosition);

  vec3 lit = albedo.rgb * uEmissive;

  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= uLightCount) break;
    int type = uLightType[i];
    if (type == 0) continue;

    if (type == 3) {
      lit += albedo.rgb * uLightColor[i];
      continue;
    }

    vec3 lightDir;
    float attenuation = 1.0;
    if (type == 1) {
      // Directional: uLightVector holds the direction the light travels, so the
      // vector toward the light is its negation.
      lightDir = normalize(-uLightVector[i]);
    } else {
      vec3 toLight = uLightVector[i] - vWorldPosition;
      float distance = length(toLight);
      lightDir = distance > 0.0001 ? toLight / distance : vec3(0.0, 1.0, 0.0);
      // Smooth inverse-square falloff, clipped at the light's range so a point
      // light cannot contribute across the whole level.
      float ratio = clamp(distance / max(uLightRange[i], 0.0001), 0.0, 1.0);
      attenuation = pow(1.0 - ratio * ratio, 2.0);
    }

    float diffuse = max(dot(normal, lightDir), 0.0);
    lit += albedo.rgb * uLightColor[i] * diffuse * attenuation;

    if (uShininess > 0.001 && diffuse > 0.0) {
      vec3 halfway = normalize(lightDir + viewDir);
      // Map the artist-facing 0..1 knob onto a usable exponent range.
      float exponent = mix(2.0, 128.0, uShininess);
      float specular = pow(max(dot(normal, halfway), 0.0), exponent);
      lit += uLightColor[i] * specular * uShininess * attenuation;
    }
  }

  if (uFogDensity > 0.0) {
    float distance = length(uCameraPosition - vWorldPosition);
    float fog = 1.0 - exp(-distance * uFogDensity);
    lit = mix(lit, uFogColor, clamp(fog, 0.0, 1.0));
  }

  fragColor = vec4(lit, albedo.a);
}`;

const SKY_VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
out vec2 vScreen;
void main() {
  vScreen = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const SKY_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 vScreen;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform float uHorizon;
out vec4 fragColor;
void main() {
  // Two ramps meeting at the horizon, so the ground half can be darker than a
  // single linear gradient would allow.
  float t = vScreen.y < uHorizon
    ? (vScreen.y / max(uHorizon, 0.0001)) * 0.5
    : 0.5 + ((vScreen.y - uHorizon) / max(1.0 - uHorizon, 0.0001)) * 0.5;
  fragColor = vec4(mix(uBottom, uTop, t), 1.0);
}`;

export class WebGL3DRenderer extends WebGL2Renderer {
  constructor(canvas, options = {}) {
    super(canvas, options);
    const gl = this.gl;

    this.capabilities = { ...this.capabilities, meshes: true, lighting: true, depth: true };

    this.meshProgram = createProgram(gl, MESH_VERTEX_SHADER, MESH_FRAGMENT_SHADER);
    this.meshUniforms = collectUniforms(gl, this.meshProgram, [
      'uModel', 'uViewProjection', 'uNormalMatrix',
      'uBaseColor', 'uUseTexture', 'uTexture', 'uShininess', 'uEmissive', 'uCameraPosition',
      'uLightCount', 'uFogColor', 'uFogDensity',
    ]);
    this.lightUniforms = [];
    for (let i = 0; i < MAX_LIGHTS; i++) {
      this.lightUniforms.push({
        type: gl.getUniformLocation(this.meshProgram, `uLightType[${i}]`),
        vector: gl.getUniformLocation(this.meshProgram, `uLightVector[${i}]`),
        color: gl.getUniformLocation(this.meshProgram, `uLightColor[${i}]`),
        range: gl.getUniformLocation(this.meshProgram, `uLightRange[${i}]`),
      });
    }

    this.skyProgram = createProgram(gl, SKY_VERTEX_SHADER, SKY_FRAGMENT_SHADER);
    this.skyUniforms = collectUniforms(gl, this.skyProgram, ['uTop', 'uBottom', 'uHorizon']);
    this.skyVao = createFullscreenQuad(gl, this.skyProgram);

    /** @type {Map<string, {vao, indexCount, indexType}>} uploaded meshes, by name */
    this.meshes = new Map();

    this.viewProjection = Mat4.create();
    this.normalMatrix = new Float32Array(9);
    this.view3d = null;
    /** Whether a 3D pass ran this frame; the 2D pass must not clear over it. */
    this.drew3DThisFrame = false;
    this.stats.meshes = 0;
  }

  /** Upload a mesh once and cache its VAO. */
  uploadMesh(mesh) {
    const gl = this.gl;
    const existing = this.meshes.get(mesh.name);
    if (existing) return existing;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);

    const stride = FLOATS_PER_VERTEX * 4;
    const positionLoc = gl.getAttribLocation(this.meshProgram, 'aPosition');
    const normalLoc = gl.getAttribLocation(this.meshProgram, 'aNormal');
    const uvLoc = gl.getAttribLocation(this.meshProgram, 'aTexCoord');

    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(normalLoc);
    gl.vertexAttribPointer(normalLoc, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, stride, 24);

    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);

    const entry = {
      vao,
      vertexBuffer,
      indexBuffer,
      indexCount: mesh.indices.length,
      indexType: mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
    };
    this.meshes.set(mesh.name, entry);
    return entry;
  }

  /** Resolve a mesh by name, generating a primitive on demand. */
  resolveMesh(name) {
    const cached = this.meshes.get(name);
    if (cached) return cached;
    const mesh = getPrimitive(name);
    if (!mesh) return null;
    return this.uploadMesh(mesh);
  }

  /**
   * Begin the 3D pass.
   * @param {object} view3d from `computeView3D`
   * @param {Array} lights resolved light records
   * @param {object|null} skybox
   */
  begin3D(view3d, lights = [], skybox = null) {
    const gl = this.gl;
    this.view3d = view3d;
    this.drew3DThisFrame = true;
    const dpr = this.pixelRatio;

    const vx = Math.round(view3d.pixelX * dpr);
    const vy = Math.round(this.canvas.height - (view3d.pixelY + view3d.pixelHeight) * dpr);
    const vw = Math.round(view3d.pixelWidth * dpr);
    const vh = Math.round(view3d.pixelHeight * dpr);

    gl.viewport(vx, vy, vw, vh);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(vx, vy, vw, vh);

    const bg = view3d.background;
    gl.clearColor(bg.r, bg.g, bg.b, bg.a);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (skybox?.enabled) this.drawSkybox(skybox);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    Mat4.multiply(this.viewProjection, view3d.projection, view3d.view);

    gl.useProgram(this.meshProgram);
    gl.uniformMatrix4fv(this.meshUniforms.uViewProjection, false, this.viewProjection);
    gl.uniform3f(
      this.meshUniforms.uCameraPosition,
      view3d.position.x, view3d.position.y, view3d.position.z,
    );
    gl.uniform1i(this.meshUniforms.uTexture, 0);
    gl.uniform1f(this.meshUniforms.uFogDensity, view3d.fogDensity ?? 0);
    const fog = view3d.fogColor ?? bg;
    gl.uniform3f(this.meshUniforms.uFogColor, fog.r, fog.g, fog.b);

    this.uploadLights(lights);

    this.stats.drawCalls = 0;
    this.stats.meshes = 0;
  }

  uploadLights(lights) {
    const gl = this.gl;
    const count = Math.min(lights.length, MAX_LIGHTS);
    gl.uniform1i(this.meshUniforms.uLightCount, count);

    for (let i = 0; i < count; i++) {
      const light = lights[i];
      const slot = this.lightUniforms[i];
      const typeCode = light.type === 'directional' ? 1 : light.type === 'point' ? 2 : 3;
      gl.uniform1i(slot.type, typeCode);
      gl.uniform3f(slot.vector, light.vector.x, light.vector.y, light.vector.z);
      gl.uniform3f(
        slot.color,
        light.color.r * light.intensity,
        light.color.g * light.intensity,
        light.color.b * light.intensity,
      );
      gl.uniform1f(slot.range, light.range ?? 20);
    }
  }

  drawSkybox(skybox) {
    const gl = this.gl;
    gl.useProgram(this.skyProgram);
    gl.bindVertexArray(this.skyVao);
    // Depth write off: the sky must never occlude geometry drawn after it.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    gl.uniform3f(this.skyUniforms.uTop, skybox.top.r, skybox.top.g, skybox.top.b);
    gl.uniform3f(this.skyUniforms.uBottom, skybox.bottom.r, skybox.bottom.g, skybox.bottom.b);
    gl.uniform1f(this.skyUniforms.uHorizon, skybox.horizon);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.depthMask(true);
    gl.bindVertexArray(null);
    this.stats.drawCalls++;
  }

  /** @param {object} command a mesh draw command from Render3DSystem */
  submitMesh(command) {
    const gl = this.gl;
    const entry = this.resolveMesh(command.mesh);
    if (!entry) return;

    gl.useProgram(this.meshProgram);
    gl.bindVertexArray(entry.vao);

    gl.uniformMatrix4fv(this.meshUniforms.uModel, false, command.matrix);
    Mat4.normalMatrix(this.normalMatrix, command.matrix);
    gl.uniformMatrix3fv(this.meshUniforms.uNormalMatrix, false, this.normalMatrix);

    const color = command.color;
    gl.uniform4f(this.meshUniforms.uBaseColor, color.r, color.g, color.b, color.a * command.opacity);
    gl.uniform1f(this.meshUniforms.uShininess, command.shininess);
    gl.uniform1f(this.meshUniforms.uEmissive, command.emissive);

    const texture = command.texture ? this.textures.get(command.texture) : null;
    gl.uniform1f(this.meshUniforms.uUseTexture, texture ? 1 : 0);
    if (texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture.texture);
    }

    if (command.doubleSided) gl.disable(gl.CULL_FACE);
    else gl.enable(gl.CULL_FACE);

    // Transparent meshes must not write depth, or the ones behind them vanish.
    const transparent = command.opacity < 1 || color.a < 1;
    gl.depthMask(!transparent);

    gl.drawElements(gl.TRIANGLES, entry.indexCount, entry.indexType, 0);

    gl.depthMask(true);
    gl.bindVertexArray(null);
    this.stats.drawCalls++;
    this.stats.meshes++;
  }

  end3D() {
    const gl = this.gl;
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    this.view3d = null;
  }

  /** Called once per frame by FrameEndSystem, after every pass. */
  finishFrame() {
    this.drew3DThisFrame = false;
  }

  /**
   * The 2D overlay pass.
   *
   * Depth testing is off and the framebuffer is *not* cleared, so sprites and
   * text composite on top of the 3D world instead of erasing it.
   */
  begin(view) {
    this.gl.disable(this.gl.DEPTH_TEST);
    // Only skip the clear when a 3D pass actually ran this frame; a purely 2D
    // scene on this renderer still needs its background painted.
    super.begin(this.drew3DThisFrame ? { ...view, clear: false } : view);
  }

  destroy() {
    const gl = this.gl;
    for (const entry of this.meshes.values()) {
      gl.deleteVertexArray(entry.vao);
      gl.deleteBuffer(entry.vertexBuffer);
      gl.deleteBuffer(entry.indexBuffer);
    }
    this.meshes.clear();
    gl.deleteProgram(this.meshProgram);
    gl.deleteProgram(this.skyProgram);
    gl.deleteVertexArray(this.skyVao);
    super.destroy();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createProgram(gl, vertexSource, fragmentSource) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`WebGL3DRenderer: shader link failed:\n${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    throw new Error(`WebGL3DRenderer: ${kind} shader failed to compile:\n${log}`);
  }
  return shader;
}

function collectUniforms(gl, program, names) {
  const out = {};
  for (const name of names) out[name] = gl.getUniformLocation(program, name);
  return out;
}

function createFullscreenQuad(gl, program) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]),
    gl.STATIC_DRAW,
  );
  const loc = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

/** Feature check callers can use before constructing the renderer. */
export function isWebGL3DAvailable() {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}
