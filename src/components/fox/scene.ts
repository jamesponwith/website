/**
 * The hero fox in 3D: the Khronos glTF sample Fox (model CC0 by PixelMannen;
 * rig and animation CC-BY 4.0 by @tomkranis), repainted in the phux palette
 * as brushed metal. It hops far back, walks toward the camera, turns to a
 * three-quarter pose, then idles while its head follows the pointer.
 */
import {
  ACESFilmicToneMapping, AnimationMixer, CanvasTexture, DirectionalLight, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Scene, ShadowMaterial, SkinnedMesh, SRGBColorSpace, Vector3, WebGLRenderer,
  Bone, type AnimationAction, type Texture,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const out = (t: number) => 1 - (1 - t) ** 3;
const inOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

// Entrance beats, in seconds.
// A quick crouch, one low forward leap, then straight into the walk.
const LEAP = [0.12, 0.52] as const;
const WALK = [0.52, 2.6] as const;
const TURN = [2.2, 3.0] as const;
export const SETTLED = 3.1;
const LEAP_SHARE = 0.33; // of the path covered in the air, so the walk picks up its speed
const LEAP_HEIGHT = 40;
const RUN_PHASE = 0.1; // Run clip phase held mid-air (fraction of the clip)
const START = new Vector3(-150, 0, -250);
const END = new Vector3(0, 0, 0);

/**
 * Texture pixels the head and neck bones drive, so plate seams skip the face:
 * its texture pieces do not line up with the body's, and seams drawn across
 * them land out of place.
 */
function headMask(mesh: SkinnedMesh, W: number, H: number) {
  const names = new Set(["b_Head_05", "b_Neck_04"]);
  const heads = new Set(mesh.skeleton.bones.flatMap((b, i) => (names.has(b.name) ? [i] : [])));
  const { uv, skinIndex, skinWeight } = mesh.geometry.attributes;
  const index = mesh.geometry.index;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  const onHead = (v: number) => {
    let best = 0, bone = -1;
    for (let k = 0; k < 4; k++) if (skinWeight!.getComponent(v, k) > best) { best = skinWeight!.getComponent(v, k); bone = skinIndex!.getComponent(v, k); }
    return heads.has(bone);
  };
  const count = index ? index.count : uv!.count;
  for (let i = 0; i < count; i += 3) {
    const v = [0, 1, 2].map(n => (index ? index.getX(i + n) : i + n));
    if (!v.some(onHead)) continue;
    g.beginPath();
    v.forEach((n, j) => g[j ? "lineTo" : "moveTo"](uv!.getX(n) * W, uv!.getY(n) * H));
    g.closePath();
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = "#fff";
    g.stroke();
  }
  const d = g.getImageData(0, 0, W, H).data, out = new Uint8Array(W * H);
  for (let p = 0; p < out.length; p++) out[p] = d[p * 4]! > 127 ? 1 : 0;
  return out;
}

const PALETTE = [[118, 124, 123], [226, 214, 188], [58, 66, 68]] as const; // silver, cream, charcoal

/**
 * Our palette on the model's own texture regions, cut like the art: flowing
 * plate seams across the silver, grooves where colours meet, and a brushed
 * grain. Returns the colour map and a matching height map for relief.
 */
function brushedMetal(map: Texture, plain?: Uint8Array) {
  const img = map.image as CanvasImageSource & { width: number; height: number };
  const W = img.width, H = img.height;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, W, H);
  // Classify: 0 silver (orange body), 1 cream (white), 2 charcoal (brown legs), 3 keep (eyes, nose).
  const cls = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) {
    const r = d.data[p * 4]!, gr = d.data[p * 4 + 1]!, b = d.data[p * 4 + 2]!, l = (r + gr + b) / 3;
    cls[p] = l > 200 ? 1 : r > 150 && r - b > 80 ? 0 : l > 40 && r > b ? 2 : 3;
  }
  const edge = (x: number, y: number) => {
    const k = cls[y * W + x]!;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && cls[ny * W + nx] !== k) return true;
    }
    return false;
  };
  const hc = document.createElement("canvas");
  hc.width = W; hc.height = H;
  const hg = hc.getContext("2d")!, h = hg.createImageData(W, H);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rows = Array.from({ length: H }, () => rnd() - 0.5);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, i = p * 4, k = cls[p]!;
    const grain = rows[y]! * 26 + Math.sin(x * 0.05 + y * 0.9) * 4;
    let tone: readonly number[] = k < 3 ? PALETTE[k]! : [d.data[i]!, d.data[i + 1]!, d.data[i + 2]!];
    let height = 150 + grain * 0.25;
    // Flowing plate seams across the silver: a dark cut with a bright bevel after it.
    const s = (x + 90 * Math.sin(y / 110) + 25 * Math.sin(y / 37)) / 165;
    const f = s - Math.floor(s);
    let lift = 0;
    const seams = k === 0 && !plain?.[p];
    if (seams && f < 0.018) { lift = -36; height = 60; }
    else if (seams && f < 0.03) { lift = 12; height = 168; }
    if (k < 3 && edge(x, y)) { lift = -30; height = 80; }
    for (let n = 0; n < 3; n++) d.data[i + n] = clamp(tone[n]! + grain + lift, 0, 255);
    h.data[i] = h.data[i + 1] = h.data[i + 2] = clamp(height, 0, 255);
    h.data[i + 3] = 255;
    tone = PALETTE[0];
  }
  g.putImageData(d, 0, 0);
  hg.putImageData(h, 0, 0);
  const colour = new CanvasTexture(c), relief = new CanvasTexture(hc);
  for (const t of [colour, relief]) t.flipY = map.flipY;
  colour.colorSpace = SRGBColorSpace;
  const material = new MeshStandardMaterial({ map: colour, bumpMap: relief, bumpScale: 3, metalness: 0.92, roughness: 0.3, flatShading: true });
  // A cool rim on edges turning away, so the silhouette reads on the dark page.
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <dithering_fragment>",
      "float rim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);\n gl_FragColor.rgb += vec3(0.55, 0.66, 0.78) * rim * 0.32;\n#include <dithering_fragment>");
  };
  return material;
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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  const scene = new Scene();
  scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.95;
  const key = new DirectionalLight("#fff6e8", 3.2);
  key.position.set(-300, 500, 400);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 6;
  Object.assign(key.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 100, far: 1400 });
  const floor = new Mesh(new PlaneGeometry(2000, 2000), new ShadowMaterial({ opacity: 0.32 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  const rim = new DirectionalLight("#cfe3ff", 1.6);
  rim.position.set(400, 250, -500);
  const shadow = contactShadow();
  const rig = new Group();
  scene.add(key, rim, floor, shadow, rig);
  const camera = new PerspectiveCamera(28, 1, 1, 5000);
  camera.position.set(104, 80, 238);
  camera.lookAt(-4, 44, -12);

  const gltf = await new GLTFLoader().loadAsync(model);
  const bones: Record<string, Bone> = {};
  gltf.scene.traverse(o => {
    if (o instanceof SkinnedMesh) {
      const map = (o.material as MeshStandardMaterial).map!;
      const { width, height } = map.image as { width: number; height: number };
      o.material = brushedMetal(map, headMask(o, width, height));
      o.castShadow = true;
    }
    if (o instanceof Bone) bones[o.name] = o;
  });
  rig.add(gltf.scene);
  const mixer = new AnimationMixer(gltf.scene);
  const clip = (name: string) => gltf.animations.find(a => a.name === name)!;
  const survey: AnimationAction = mixer.clipAction(clip("Survey")).play();
  const walk: AnimationAction = mixer.clipAction(clip("Walk")).play();
  const run: AnimationAction = mixer.clipAction(clip("Run")).play();
  const runLength = clip("Run").duration;
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
    // Path: a ballistic leap covers the first share, the walk the rest.
    const u = clamp((t - LEAP[0]) / (LEAP[1] - LEAP[0]));
    const w = clamp((t - WALK[0]) / (WALK[1] - WALK[0]));
    const along = t < WALK[0] ? LEAP_SHARE * u : LEAP_SHARE + (1 - LEAP_SHARE) * out(w);
    const p = START.clone().lerp(END, along);
    const airborne = t > LEAP[0] && t < LEAP[1];
    const hopY = airborne ? 4 * LEAP_HEIGHT * u * (1 - u) : 0;
    // The body follows the arc: nose up rising, nose down falling.
    const pitch = airborne ? -0.22 * (1 - 2 * u) * Math.sin(Math.PI * u) ** 0.5 : 0;
    // Crouch before take-off, absorb on landing.
    const crouch = Math.sin(Math.PI * clamp(t / LEAP[0]));
    const land = Math.sin(Math.PI * clamp((t - LEAP[1]) / 0.2));
    const squash = 1 - 0.07 * crouch - 0.06 * land;
    rig.position.set(p.x, hopY, p.z);
    const heading = Math.atan2(END.x - START.x, END.z - START.z);
    const turn = inOut(clamp((t - TURN[0]) / (TURN[1] - TURN[0])));
    rig.rotation.set(pitch, heading * (1 - turn) + 0.75 * turn, 0, "YXZ");
    rig.scale.set(1, squash, 1);
    shadow.position.set(p.x, 0.5, p.z + 8);
    const s = 130 * (1 - hopY / 120);
    shadow.scale.set(s * 0.9, s * 1.7, 1);
    (shadow.material as MeshBasicMaterial).opacity = 1 - hopY / 70;

    // Legs: stretched Run pose in the air, Walk on the ground, Survey's calm frame at rest.
    const wRun = airborne ? Math.sin(Math.PI * u) ** 0.6 : 0;
    const wWalk = t > WALK[0] - 0.08 && t < WALK[1] + 0.2 ? clamp(Math.min((t - WALK[0] + 0.08) / 0.18, (WALK[1] + 0.2 - t) / 0.35)) : 0;
    run.setEffectiveWeight(wRun);
    run.time = runLength * RUN_PHASE;
    run.timeScale = 0;
    walk.setEffectiveWeight(wWalk * (1 - wRun));
    walk.timeScale = 1 - 0.45 * out(w);
    survey.setEffectiveWeight(clamp(1 - wRun - wWalk));
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
