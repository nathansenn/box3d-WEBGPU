import * as THREE from 'three';
import {createWorld, BodyRing, pauseOnHidden} from 'box3d-webgpu-kit';
import {createBodyMesh, syncInstancedMesh} from 'box3d-webgpu-kit/three';

const world = await createWorld({seed: 1});
pauseOnHidden(world);
for (let i = 0; i < 60; i++) world.spawnBox({position: [(i % 6) - 2.5, 0.5 + Math.floor(i / 6) * 1.05, 0], halfSize: 0.48});
const shots = new BodyRing(world, 50);

const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(devicePixelRatio);
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 500);
camera.position.set(9, 7, 14);
camera.lookAt(0, 3, 0);
scene.add(new THREE.HemisphereLight(0xdde8ff, 0x202030, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(5, 12, 8);
scene.add(sun);
const mesh = createBodyMesh(THREE, world);
scene.add(mesh);

addEventListener('pointerdown', event => {
  if (!innerWidth || !innerHeight) return;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(event.clientX / innerWidth * 2 - 1, -(event.clientY / innerHeight) * 2 + 1), camera);
  shots.spawn({position: camera.position, halfSize: 0.35, impulse: ray.ray.direction.clone().multiplyScalar(60)});
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let last = performance.now();
renderer.setAnimationLoop(now => {
  const {alpha} = world.update((now - last) / 1000);
  last = now;
  syncInstancedMesh(world, mesh, {alpha});
  renderer.render(scene, camera);
});
