# Hero fox model

`public/fox/fox-sculpted.glb` is built from the mascot art in three steps.

1. **Generate** a textured mesh from `mascot.png` with the TRELLIS.2 Hugging Face Space (MIT):
   `HF_TOKEN=… python generate.py 42` → `fox-42.glb` (needs `pip install gradio_client`).
2. **Rig** it onto the Khronos glTF sample Fox skeleton (`khronos.glb`, rig and animation CC-BY 4.0 by @tomkranis) with Blender:
   `blender -b -P rig.py -- <dir> <dir>/fox-42.glb <dir>/fox-rigged.glb 35000`.
   It orients and scales the mesh by its paws, fits the skeleton to it, weights a voxel-remeshed proxy and transfers those weights, then exports with the Survey, Walk and Run clips.
3. **Compress** for the web:
   `npx @gltf-transform/cli optimize fox-rigged.glb fox-sculpted.glb --compress meshopt --texture-compress webp --texture-size 1024 --simplify false`.

The mascot's head is turned toward the viewer, and the model keeps that turn; `src/components/fox/scene.ts` yaws it back at runtime (`HEAD_TURN_WALK`, `HEAD_TURN_REST`).
