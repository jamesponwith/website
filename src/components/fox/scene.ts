/**
 * The hero fox in 3D: our sculpted metal mascot, lifted to 3D with TRELLIS.2
 * (MIT) and bound to the Khronos glTF sample Fox skeleton (rig and animation
 * CC-BY 4.0 by @tomkranis). It leaps in far back, walks toward the camera,
 * turns to a three-quarter pose, then idles while its head follows the pointer.
 */
import {
  ACESFilmicToneMapping, AnimationMixer, CanvasTexture, DirectionalLight, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Quaternion, Scene, ShadowMaterial, SkinnedMesh, Vector3, WebGLRenderer,
  Bone, type AnimationAction,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// Entrance beats, in seconds.
// A quick crouch, one low forward leap, then a walk that eases to a stop.
const LEAP = [0.12, 0.52] as const;
const WALK = [0.52, 2.95] as const; // legs fade out over the last FADE seconds
const FADE = 0.45;
export const SETTLED = 3.1;
const LEAP_SHARE = 0.25; // of the path covered in the air
const LEAP_HEIGHT = 40;
const RUN_PHASE = 0.1; // Run clip phase held mid-air (fraction of the clip)
const REST_HEADING = 0.75; // three-quarter on to the camera
const smooth = (x: number) => { const t = clamp(x); return t * t * (3 - 2 * t); };

// The path curves so the fox always faces where it walks and arrives already
// at its resting angle: no turning on the spot.
const START = new Vector3(-150, 0, -250);
const END = new Vector3(0, 0, 0);
const BEND = END.clone().sub(new Vector3(Math.sin(REST_HEADING), 0, Math.cos(REST_HEADING)).multiplyScalar(140));
const curve = (s: number) => START.clone().multiplyScalar((1 - s) ** 2).add(BEND.clone().multiplyScalar(2 * (1 - s) * s)).add(END.clone().multiplyScalar(s * s));
const tangent = (s: number) => BEND.clone().sub(START).multiplyScalar(2 * (1 - s)).add(END.clone().sub(BEND).multiplyScalar(2 * s));
// Arc-length table, so distance along the path maps to a point at even speed.
const ARC = (() => {
  const n = 128, out = [0];
  for (let i = 1; i <= n; i++) out.push(out[i - 1]! + curve(i / n).distanceTo(curve((i - 1) / n)));
  return out;
})();
const PATH = ARC.at(-1)!;
function atDistance(d: number) {
  const n = ARC.length - 1, target = clamp(d, 0, PATH);
  let i = 1;
  while (i < n && ARC[i]! < target) i++;
  const s = (i - 1 + (target - ARC[i - 1]!) / (ARC[i]! - ARC[i - 1]! || 1)) / n;
  return { point: curve(s), heading: Math.atan2(tangent(s).x, tangent(s).z) };
}

// The walk travels exactly as fast as a planted paw sweeps back, or the fox
// skates. STRIDE is that sweep speed for the Walk clip at timeScale 1. The
// clip's pace eases down, then its weight fades; the body's speed follows both.
const STRIDE = 140;
const walkLength = WALK[1] - WALK[0];
const pace = (tau: number) => 1 - 0.5 * smooth(tau / walkLength); // relative clip pace
const legs = (tau: number) => smooth((walkLength - tau) / FADE); // walk weight at the end
const WALKED = (() => { // cumulative relative distance, sampled every 10 ms
  const out = [0];
  for (let i = 1; i * 0.01 <= walkLength + 1e-9; i++) out.push(out[i - 1]! + pace(i * 0.01) * legs(i * 0.01) * 0.01);
  return out;
})();
const WALK_SPEED = ((1 - LEAP_SHARE) * PATH) / (STRIDE * WALKED.at(-1)!); // clip timeScale at full pace
const walkedShare = (tau: number) => {
  const k = clamp(tau / 0.01, 0, WALKED.length - 1), i = Math.floor(k), f = k - i;
  const a = WALKED[i]!, b = WALKED[Math.min(i + 1, WALKED.length - 1)]!;
  return (a + (b - a) * f) / WALKED.at(-1)!;
};
// The mascot was drawn with its head turned to the viewer, and the model kept
// that turn. Yaw it back to face the way it walks, then partly toward the
// camera at rest, spread down the spine so the neck twists, never tears.
const HEAD_TURN_WALK = 1.64;
const HEAD_TURN_REST = 0.9;
const LOOK_TURN = 0.6; // radians of head turn at the pointer's full reach

/** A cool rim on edges turning away, so the silhouette reads on the dark page. */
function addRim(material: MeshStandardMaterial) {
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <dithering_fragment>",
      "float rim = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);\n gl_FragColor.rgb += vec3(0.55, 0.66, 0.78) * rim * 0.32;\n#include <dithering_fragment>");
  };
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
  renderer.shadowMap.type = PCFShadowMap;
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

  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(model);
  const bones: Record<string, Bone> = {};
  gltf.scene.traverse(o => {
    if (o instanceof SkinnedMesh) {
      addRim(o.material as MeshStandardMaterial);
      o.castShadow = true;
      o.frustumCulled = false; // the skinned leap leaves the rest-pose bounds
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
  // The walk flexes elbows, paws and hocks hard enough to kink this sculpted
  // body's stockings and stretch its hind legs; ease them halfway to standing.
  // The front wrists sit right at the top of the paw, so they go further:
  // mostly back to the model's own straight (bind) pose, walking and standing.
  const DAMP = 0.5, WRIST_DAMP = 0.85;
  const wrists = new Set(["b_RightHand_08", "b_LeftHand_011"]);
  const damped = ["b_RightForeArm_07", "b_LeftForeArm_010", "b_RightHand_08", "b_LeftHand_011", "b_RightFoot01_021", "b_LeftFoot01_017", "b_RightFoot02_022", "b_LeftFoot02_018"]
    .map(name => bones[name]!).filter(Boolean);
  const bindPose = damped.map(b => b.quaternion.clone()); // before any clip runs
  // At rest the hips, spine and legs return to the sculpted stance (all four
  // paws level), not the idle clip's, which stands the fox with its weight to
  // one side: one front paw sinks into the floor and the other lifts.
  const LEG_BONES = ["b_Hip_01", "b_Spine01_02", "b_Spine02_03", "b_RightUpperArm_06", "b_RightForeArm_07", "b_RightHand_08", "b_LeftUpperArm_09", "b_LeftForeArm_010", "b_LeftHand_011",
    "b_RightLeg01_019", "b_RightLeg02_020", "b_RightFoot01_021", "b_RightFoot02_022", "b_LeftLeg01_015", "b_LeftLeg02_016", "b_LeftFoot01_017", "b_LeftFoot02_018"]
    .map(name => bones[name]!).filter(Boolean);
  const legBind = LEG_BONES.map(b => b.quaternion.clone());
  const hip = bones.b_Hip_01!, hipBind = hip.position.clone(), hipClip = new Vector3();
  const offsetBones = [...new Set([neck, head, spine, tail, ...damped, ...LEG_BONES])];
  let standing: Quaternion[] | undefined;
  let base = offsetBones.map(b => b.quaternion.clone());
  const undoOffsets = () => {
    offsetBones.forEach((b, i) => b.quaternion.copy(base[i]!));
    hip.position.copy(hipClip);
  };

  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  let t = 0;
  // Yaw a bone about world up, in its parent's space.
  const up = new Vector3(), turnBy = new Quaternion(), parentQ = new Quaternion();
  const yaw = (bone: Bone, angle: number) => {
    bone.parent!.getWorldQuaternion(parentQ);
    up.set(0, 1, 0).applyQuaternion(parentQ.invert());
    bone.quaternion.premultiply(turnBy.setFromAxisAngle(up, angle));
  };
  // Bend a bone about the fox's own side-to-side axis (positive swings a
  // downward bone backward), in its parent's space.
  const side = new Vector3(), rigQ = new Quaternion();
  const bend = (bone: Bone, angle: number) => {
    rig.getWorldQuaternion(rigQ);
    bone.parent!.getWorldQuaternion(parentQ);
    side.set(1, 0, 0).applyQuaternion(rigQ).applyQuaternion(parentQ.invert());
    bone.quaternion.premultiply(turnBy.setFromAxisAngle(side, angle));
  };
  const FRONT_BEND = (8 * Math.PI) / 180; // paws a touch ahead of the elbows
  const HIND_BEND = (12 * Math.PI) / 180; // knee forward, hock back
  // The sculpted hind legs splay out and reach back; gather them in under the
  // hips so the fox stands compact and ready to move.
  const HIND_IN = (10 * Math.PI) / 180;
  const HIND_TUCK = (10 * Math.PI) / 180;
  // Swing a bone about the fox's own forward axis, in its parent's space.
  const fwdAx = new Vector3();
  const roll = (bone: Bone, angle: number) => {
    rig.getWorldQuaternion(rigQ);
    bone.parent!.getWorldQuaternion(parentQ);
    fwdAx.set(0, 0, 1).applyQuaternion(rigQ).applyQuaternion(parentQ.invert());
    bone.quaternion.premultiply(turnBy.setFromAxisAngle(fwdAx, angle));
  };

  function pose(dt: number) {
    // Path: a ballistic leap covers the first share, the walk the rest.
    const u = clamp((t - LEAP[0]) / (LEAP[1] - LEAP[0]));
    const tau = t - WALK[0];
    const along = t < WALK[0] ? LEAP_SHARE * u : LEAP_SHARE + (1 - LEAP_SHARE) * walkedShare(tau);
    const { point: p, heading } = atDistance(along * PATH);
    const airborne = t > LEAP[0] && t < LEAP[1];
    const hopY = airborne ? 4 * LEAP_HEIGHT * u * (1 - u) : 0;
    // The body follows the arc: nose up rising, nose down falling.
    const pitch = airborne ? -0.22 * (1 - 2 * u) * Math.sin(Math.PI * u) ** 0.5 : 0;
    // Crouch before take-off, absorb on landing.
    const crouch = Math.sin(Math.PI * clamp(t / LEAP[0]));
    const land = Math.sin(Math.PI * clamp((t - LEAP[1]) / 0.2));
    const squash = 1 - 0.07 * crouch - 0.06 * land;
    rig.position.set(p.x, hopY, p.z);
    const turn = smooth((tau - (walkLength - 0.9)) / 0.9); // head eases toward the camera on arrival
    rig.rotation.set(pitch, heading, 0, "YXZ");
    rig.scale.set(1, squash, 1);
    shadow.position.set(p.x, 0.5, p.z + 8);
    const s = 130 * (1 - hopY / 120);
    shadow.scale.set(s * 0.9, s * 1.7, 1);
    (shadow.material as MeshBasicMaterial).opacity = 1 - hopY / 70;

    // Legs: stretched Run pose in the air, Walk on the ground, Survey's calm frame at rest.
    const wRun = airborne ? Math.sin(Math.PI * u) ** 0.6 : 0;
    const wWalk = t > WALK[0] - 0.08 && t < WALK[1] ? Math.min(clamp((tau + 0.08) / 0.18), legs(tau)) : 0;
    run.setEffectiveWeight(wRun);
    run.time = runLength * RUN_PHASE;
    run.timeScale = 0;
    walk.setEffectiveWeight(wWalk * (1 - wRun));
    walk.timeScale = WALK_SPEED * pace(clamp(tau, 0, walkLength));
    survey.setEffectiveWeight(clamp(1 - wRun - wWalk));
    survey.time = 3; // a calm frame, facing the viewer
    survey.timeScale = 0;
    mixer.update(dt);
    base = offsetBones.map(b => b.quaternion.clone());
    standing ??= damped.map(b => b.quaternion.clone()); // Survey's calm frame, before any stride
    damped.forEach((b, i) => wrists.has(b.name)
      ? b.quaternion.slerp(bindPose[i]!, WRIST_DAMP)
      : b.quaternion.slerp(standing![i]!, DAMP));
    const still = clamp(1 - wRun - wWalk);
    hipClip.copy(hip.position);
    if (still > 0) {
      LEG_BONES.forEach((b, i) => b.quaternion.slerp(legBind[i]!, still));
      hip.position.lerp(hipBind, still);
      // A relaxed stance, the same on both sides so the paws stay level: soft
      // shoulders, elbows and wrists in front, the dog-leg knee and hock behind,
      // with a breath-slow give in the joints.
      rig.updateMatrixWorld(true);
      const give = 1 + 0.12 * Math.sin((2 * Math.PI * t) / 3.6);
      const f = FRONT_BEND * still * give, h = HIND_BEND * still * give;
      for (const [upper, lower, paw] of [["b_RightUpperArm_06", "b_RightForeArm_07", "b_RightHand_08"], ["b_LeftUpperArm_09", "b_LeftForeArm_010", "b_LeftHand_011"]] as const) {
        bend(bones[upper]!, f); bend(bones[lower]!, -2 * f); bend(bones[paw]!, f);
      }
      for (const [thigh, shin, foot] of [["b_RightLeg01_019", "b_RightLeg02_020", "b_RightFoot01_021"], ["b_LeftLeg01_015", "b_LeftLeg02_016", "b_LeftFoot01_017"]] as const) {
        bend(bones[thigh]!, h - HIND_TUCK * still); bend(bones[shin]!, -2 * h); bend(bones[foot]!, h);
      }
      // Hind legs drawn in under the hips (the fox's right is its -X side).
      roll(bones.b_RightLeg01_019!, HIND_IN * still);
      roll(bones.b_LeftLeg01_015!, -HIND_IN * still);
    }

    // Idle on top: a breath, a slow tail sway. Then the pointer look.
    const idle = clamp((t - WALK[1] + FADE) / 0.8);
    spine.rotation.x += idle * 0.02 * Math.sin((2 * Math.PI * t) / 3.6);
    tail.rotation.y += idle * 0.12 * Math.sin((2 * Math.PI * t) / 4.4);
    const on = clamp((t - SETTLED) / 0.6);
    look.x += (look.tx * on - look.x) * Math.min(1, dt * 6);
    look.y += (look.ty * on - look.y) * Math.min(1, dt * 6);
    const headTurn = HEAD_TURN_WALK + (HEAD_TURN_REST - HEAD_TURN_WALK) * turn - look.x * LOOK_TURN;
    rig.updateMatrixWorld(true);
    yaw(spine, headTurn * 0.1);
    yaw(neck, headTurn * 0.3);
    yaw(head, headTurn * 0.6);
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
