// The 3D object, rendered with Three.js into its own transparent canvas.
// render.js composites that canvas into the stage and handles occlusion.
import * as THREE from './vendor/three/three.module.js';
import { ORB3D } from './config.js';

const RINGS = 12, RING_POINTS = 96, PARTICLES = 90;

export function createOrb3D(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);

  // One world unit is one stage pixel on the z = 0 plane.
  const distance = ORB3D.cameraDistancePx;
  const fov = 2 * Math.atan(height / 2 / distance) * 180 / Math.PI;
  const camera = new THREE.PerspectiveCamera(fov, width / height, 10, distance * 3);
  camera.position.z = distance;

  const scene = new THREE.Scene();
  const ambient = new THREE.AmbientLight(0xffffff, 1.4);
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  scene.add(ambient, key);

  const group = new THREE.Group();
  scene.add(group);

  // Faceted crystal core: lit by the room, so rotation and lighting read clearly.
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0xc9a8ff, emissive: 0x7a3cff, emissiveIntensity: 0.6,
    roughness: 0.3, metalness: 0.35, flatShading: true,
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), coreMaterial);
  const cage = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(0.62, 1)),
    new THREE.LineBasicMaterial({ color: 0xff9cf5, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  group.add(core, cage);

  // Glowing filament rings, each tilted differently and rippling over time.
  const rings = [];
  for (let j = 0; j < RINGS; j++) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RING_POINTS * 3), 3));
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color().setHSL((280 + j * 3) / 360, 1, 0.65 + (j % 3) * 0.08),
      transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ring = new THREE.LineLoop(geometry, material);
    ring.rotation.set(j * 0.37, j * 0.61, 0);
    rings.push(ring);
    group.add(ring);
  }

  const particlePositions = new Float32Array(PARTICLES * 3);
  for (let i = 0; i < PARTICLES; i++) {
    // Deterministic scatter on a shell between radius 1.1 and 1.6.
    const u = (Math.sin(i * 12.9898) * 43758.5453) % 1, v = (Math.sin(i * 78.233) * 12345.678) % 1;
    const theta = Math.abs(u) * Math.PI * 2, phi = Math.acos(2 * Math.abs(v) - 1), r = 1.1 + (i % 7) / 12;
    particlePositions.set([r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)], i * 3);
  }
  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  const particles = new THREE.Points(particleGeometry, new THREE.PointsMaterial({
    color: 0xffc6ff, size: 2.5, sizeAttenuation: false, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  group.add(particles);

  const basisMatrix = new THREE.Matrix4(), target = new THREE.Quaternion();
  const axisX = new THREE.Vector3(), axisY = new THREE.Vector3(), axisZ = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0), TILT = new THREE.Vector3(1, 0, 0);
  let lastTime = null, frames = 0;

  // x, y: stage pixels. radius: pixels. basis: palm axes while held, else null.
  // room: { r, g, b, dx, dy } sampled from the camera, or null.
  function render(t, { x, y, radius, basis, room, held }) {
    const dt = lastTime === null ? 16 : Math.min(100, t - lastTime);
    lastTime = t;

    group.position.set(x - width / 2, height / 2 - y, 0);
    group.scale.setScalar(radius);
    if (basis) {
      basisMatrix.makeBasis(axisX.fromArray(basis[0]), axisY.fromArray(basis[1]), axisZ.fromArray(basis[2]));
      target.setFromRotationMatrix(basisMatrix);
      group.quaternion.slerp(target, ORB3D.rotationSmoothing);
    } else {
      group.rotateOnWorldAxis(UP, dt * ORB3D.idleSpin);
      group.rotateOnWorldAxis(TILT, dt * ORB3D.idleSpin * 0.4);
    }

    const speed = held ? 1.6 : 1;
    rings.forEach((ring, j) => {
      const positions = ring.geometry.attributes.position;
      for (let i = 0; i < RING_POINTS; i++) {
        const a = i / RING_POINTS * Math.PI * 2;
        const r = 1 + 0.16 * Math.sin(a * 3 + t * 0.002 * speed + j * 0.25);
        positions.setXYZ(i, Math.cos(a) * r, Math.sin(a) * r, Math.sin(a * 2 + t * 0.003 * speed + j * 0.2) * 0.24);
      }
      positions.needsUpdate = true;
    });
    particles.rotation.y += dt * 0.0005 * speed;
    particles.rotation.x += dt * 0.0002;
    cage.rotation.y -= dt * 0.0004;
    coreMaterial.emissiveIntensity = (held ? 0.85 : 0.6) + 0.1 * Math.sin(t * 0.004);

    if (room) {
      // Tint the lights with the room, but keep them bright enough to read.
      const lift = c => 0.35 + 0.65 * c;
      ambient.color.setRGB(lift(room.r), lift(room.g), lift(room.b));
      key.color.setRGB(lift(room.r), lift(room.g), lift(room.b));
      key.position.set(room.dx, -room.dy, 0.8); // screen y is down, world y is up
    } else {
      key.position.set(-0.4, 0.6, 0.8);
    }

    renderer.render(scene, camera);
    frames++;
  }

  return { canvas, render, get frames() { return frames; } };
}
