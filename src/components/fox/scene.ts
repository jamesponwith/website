/**
 * The hero fox in 3D: the Khronos glTF sample Fox (model CC0 by PixelMannen;
 * rig and animation CC-BY 4.0 by @tomkranis), repainted in the phux palette
 * as brushed metal. It hops far back, walks toward the camera, turns to a
 * three-quarter pose, then idles while its head follows the pointer.
 */
import {
  ACESFilmicToneMapping, AnimationMixer, CanvasTexture, DirectionalLight, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Scene, SkinnedMesh, SRGBColorSpace, Vector3, WebGLRenderer,
  Bone, type AnimationAction, type Texture,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const out = (t: number) => 1 - (1 - t) ** 3;
const inOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

// Entrance beats, in seconds.
const HOP = [0.35, 0.95] as const;
const WALK = [1.05, 3.1] as const;
const TURN = [2.6, 3.5] as const;
export const SETTLED = 3.6;
const START = new Vector3(-70, 0, -260);
const END = new Vector3(0, 0, 0);

/** Our palette on the model's own texture regions, with a brushed grain. */
function brushedMetal(map: Texture) {
  const img = map.image as CanvasImageSource & { width: number; height: number };
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rows = Array.from({ length: c.height }, () => rnd() - 0.5);
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i]!, gr = d.data[i + 1]!, b = d.data[i + 2]!;
    const y = (i / 4 / c.width) | 0, x = (i / 4) % c.width;
    const grain = rows[y]! * 26 + Math.sin(x * 0.05 + y * 0.9) * 4;
    const l = (r + gr + b) / 3;
    // orange body -> silver, white chest/cheeks/tail tip -> cream, brown legs -> charcoal
    const tone = l > 200 ? [226, 214, 188] : r > 150 && r - b > 80 ? [132, 138, 136] : l > 40 && r > b ? [58, 66, 68] : [r, gr, b];
    for (let k = 0; k < 3; k++) d.data[i + k] = clamp(tone[k]! + grain, 0, 255);
  }
  g.putImageData(d, 0, 0);
  const t = new CanvasTexture(c);
  t.flipY = map.flipY;
  t.colorSpace = SRGBColorSpace;
  return new MeshStandardMaterial({ map: t, metalness: 0.92, roughness: 0.3, flatShading: true });
}

function contactShadow() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!, r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(0,0,0,.55)");
  r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const mesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: new CanvasTexture(c), transparent: true, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

export interface FoxScene { look(x: number, y: number): void; stop(): void }

/** Load the model into `canvas` and play the entrance. Rejects if WebGL or the model fails. */
export async function startFox(canvas: HTMLCanvasElement, model: string): Promise<FoxScene> {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  const scene = new Scene();
  scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.95;
  const key = new DirectionalLight("#fff6e8", 3.2);
  key.position.set(-300, 500, 400);
  const rim = new DirectionalLight("#cfe3ff", 1.6);
  rim.position.set(400, 250, -500);
  const shadow = contactShadow();
  const rig = new Group();
  scene.add(key, rim, shadow, rig);
  const camera = new PerspectiveCamera(28, 1, 1, 5000);
  camera.position.set(104, 80, 238);
  camera.lookAt(-4, 44, -12);

  const gltf = await new GLTFLoader().loadAsync(model);
  const bones: Record<string, Bone> = {};
  gltf.scene.traverse(o => {
    if (o instanceof SkinnedMesh) o.material = brushedMetal((o.material as MeshStandardMaterial).map!);
    if (o instanceof Bone) bones[o.name] = o;
  });
  rig.add(gltf.scene);
  const mixer = new AnimationMixer(gltf.scene);
  const clip = (name: string) => gltf.animations.find(a => a.name === name)!;
  const survey: AnimationAction = mixer.clipAction(clip("Survey")).play();
  const walk: AnimationAction = mixer.clipAction(clip("Walk")).play();
  const neck = bones.b_Neck_04!, head = bones.b_Head_05!, spine = bones.b_Spine02_03!, tail = bones.b_Tail01_012!;
  // three's mixer skips writing a bone whose clip value has not changed, so
  // with the idle frame held still our offsets would pile up. They are
  // applied for the render only, then undone.
  const offsetBones = [neck, head, spine, tail];
  let base = offsetBones.map(b => b.quaternion.clone());
  const undoOffsets = () => offsetBones.forEach((b, i) => b.quaternion.copy(base[i]!));

  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  let t = 0;

  function pose(dt: number) {
    const w = clamp((t - WALK[0]) / (WALK[1] - WALK[0]));
    const p = START.clone().lerp(END, out(w));
    const h = (t - HOP[0]) / (HOP[1] - HOP[0]);
    let hopY = 0, pitch = 0, squash = 1;
    if (h > 0 && h < 1) {
      hopY = Math.sin(Math.PI * h) * 46;
      pitch = -0.16 * Math.sin(Math.PI * h * 1.15) + 0.08 * Math.sin(Math.PI * clamp(h * 1.6 - 0.6));
    } else if (h >= 1 && h < 1.35) squash = 1 - 0.06 * Math.sin((Math.PI * (h - 1)) / 0.35);
    else if (h > -0.3 && h <= 0) squash = 1 - 0.07 * Math.sin((Math.PI * (h + 0.3)) / 0.3);
    rig.position.set(p.x, hopY, p.z);
    const heading = Math.atan2(END.x - START.x, END.z - START.z);
    const turn = inOut(clamp((t - TURN[0]) / (TURN[1] - TURN[0])));
    rig.rotation.set(pitch, heading * (1 - turn) + 0.75 * turn, 0, "YXZ");
    rig.scale.set(1, squash, 1);
    shadow.position.set(p.x, 0.5, p.z + 8);
    const s = 130 * (1 - hopY / 160);
    shadow.scale.set(s * 0.9, s * 1.7, 1);
    (shadow.material as MeshBasicMaterial).opacity = 1 - hopY / 120;

    // Walk while travelling; otherwise hold Survey's first, calm frame.
    const wWalk = t > WALK[0] - 0.1 && t < WALK[1] + 0.2 ? clamp(Math.min((t - WALK[0] + 0.1) / 0.25, (WALK[1] + 0.2 - t) / 0.35)) : 0;
    walk.setEffectiveWeight(wWalk);
    walk.timeScale = 1 - 0.45 * out(w);
    survey.setEffectiveWeight(1 - wWalk);
    survey.time = 3; // a calm frame, facing the viewer
    survey.timeScale = 0;
    mixer.update(dt);
    base = offsetBones.map(b => b.quaternion.clone());

    // Idle on top: a breath, a slow tail sway. Then the pointer look.
    const idle = clamp((t - WALK[1]) / 0.8);
    spine.rotation.x += idle * 0.02 * Math.sin((2 * Math.PI * t) / 3.6);
    tail.rotation.y += idle * 0.12 * Math.sin((2 * Math.PI * t) / 4.4);
    const on = clamp((t - SETTLED) / 0.6);
    look.x += (look.tx * on - look.x) * Math.min(1, dt * 6);
    look.y += (look.ty * on - look.y) * Math.min(1, dt * 6);
    neck.rotation.y += look.x * 0.25;
    head.rotation.y += look.x * 0.45;
    head.rotation.x += look.y * 0.3;
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  let last = 0, running = false, visible = false;
  const frame = (now: number) => {
    // rAF stamps can precede the last performance.now(); never step backwards.
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    t += dt;
    pose(dt);
    renderer.render(scene, camera);
    undoOffsets();
  };
  const sync = () => {
    const go = visible && !document.hidden;
    if (go === running) return;
    running = go;
    last = performance.now();
    renderer.setAnimationLoop(go ? frame : null);
  };
  const observer = new IntersectionObserver(([entry]) => { visible = entry!.isIntersecting; sync(); });
  const resizer = new ResizeObserver(resize);
  resize();
  pose(0);
  renderer.render(scene, camera);
  undoOffsets();
  observer.observe(canvas);
  resizer.observe(canvas);
  document.addEventListener("visibilitychange", sync);

  return {
    look(x, y) { look.tx = clamp(x, -1, 1); look.ty = clamp(y, -1, 1); },
    stop() {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      resizer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      renderer.dispose();
    },
  };
}
