/**
 * Portal Glow Effect (saved from v0.2.505 camera-relative sun experiment)
 *
 * A camera-relative glowing orb with multi-layer corona, radial god rays,
 * and additive blending. Created the beautiful "portal in the arena" effect
 * when the sun sprite was positioned at 360 units from the camera.
 *
 * Usage: import { createPortalGlow } from './effects/portalGlow.js';
 *        const portal = createPortalGlow(scene, position, options);
 *        portal.tick(dt, camera);  // call each frame
 *        portal.dispose();         // cleanup
 */

import * as THREE from 'three';

export function createPortalGlow(scene, position = new THREE.Vector3(0, 0, 0), options = {}) {
  const {
    radius = 27,
    rayRadius = 40,
    color = new THREE.Color(0.98, 0.58, 0.20),
    glowColor = new THREE.Color(0.95, 0.50, 0.15),
    cameraDist = 360,
    rayDist = 365,
  } = options;

  // ── Sun disc + corona ──────────────────────────────────────────────
  const sunMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0.0 } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv - 0.5;
        float dist = length(p);
        if (dist > 0.48) discard;
        float disc = 1.0 - smoothstep(0.10, 0.18, dist);
        float coronaInner = (1.0 - smoothstep(0.18, 0.32, dist)) * 0.55;
        float coronaOuter = (1.0 - smoothstep(0.32, 0.46, dist)) * 0.25;
        float corona = coronaInner + coronaOuter;
        vec3 col = vec3(0.98, 0.58, 0.20) * disc + vec3(0.95, 0.50, 0.15) * corona;
        col *= 0.95 + 0.05 * sin(uTime * 0.5);
        float alpha = clamp(disc + corona, 0.0, 1.0);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    fog: false,
  });

  const sunSprite = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), sunMat);
  sunSprite.userData.isBillboard = true;
  sunSprite.frustumCulled = false;
  scene.add(sunSprite);

  // ── God rays ───────────────────────────────────────────────────────
  const rayMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0.0 } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv - 0.5;
        float dist = length(p);
        float mask = 1.0 - smoothstep(0.20, 0.35, dist);
        if (mask <= 0.001) discard;
        float core = (1.0 - smoothstep(0.0, 0.12, dist)) * 0.28;
        float angle = atan(p.y, p.x);
        float rays = 0.0;
        rays += pow(0.5 + 0.5 * sin(angle * 8.0 + uTime * 0.3), 4.0) * 0.15;
        rays += pow(0.5 + 0.5 * sin(angle * 13.0 - uTime * 0.2), 6.0) * 0.10;
        rays += pow(0.5 + 0.5 * sin(angle * 21.0 + uTime * 0.15), 8.0) * 0.06;
        float fade = (1.0 - smoothstep(0.05, 0.30, dist));
        float alpha = (core + rays * fade) * mask;
        vec3 col = vec3(0.98, 0.58, 0.20) * 0.8;
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
  });

  const godRays = new THREE.Mesh(new THREE.CircleGeometry(rayRadius, 64), rayMat);
  godRays.userData.isBillboard = true;
  godRays.frustumCulled = false;
  scene.add(godRays);

  // Direction from portal to camera (portal faces the camera)
  const _dir = new THREE.Vector3();

  return {
    sunSprite,
    godRays,
    sunMat,
    rayMat,

    tick(dt, camera) {
      sunMat.uniforms.uTime.value += dt;
      rayMat.uniforms.uTime.value += dt;

      // Camera-relative: portal always faces camera and stays at fixed distance
      _dir.subVectors(camera.position, position).normalize();
      sunSprite.position.copy(camera.position).addScaledVector(_dir, -cameraDist);
      godRays.position.copy(camera.position).addScaledVector(_dir, -rayDist);
      sunSprite.quaternion.copy(camera.quaternion);
      godRays.quaternion.copy(camera.quaternion);
    },

    dispose() {
      scene.remove(sunSprite);
      scene.remove(godRays);
      sunSprite.geometry.dispose();
      godRays.geometry.dispose();
      sunMat.dispose();
      rayMat.dispose();
    },
  };
}
