# Generate the 3D fox from the mascot with the TRELLIS.2 Space. See README.md.
import os, shutil, sys, time
from gradio_client import Client, handle_file
seed = float(sys.argv[1]) if len(sys.argv) > 1 else 42
c = Client("microsoft/TRELLIS.2", token=os.environ["HF_TOKEN"], verbose=False)
t = time.time()
c.predict(api_name="/start_session")
pre = c.predict(handle_file("mascot.png"), api_name="/preprocess_image")
print("preprocessed", pre, round(time.time() - t), "s", flush=True)
shutil.copy(pre if isinstance(pre, str) else pre["path"], f"pre-{int(seed)}.png")
prev = c.predict(handle_file(f"pre-{int(seed)}.png"), seed, "1024", api_name="/image_to_3d")
print("generated", str(prev)[:200], round(time.time() - t), "s", flush=True)
glb = c.predict(100000, 2048, api_name="/extract_glb")
print("extracted", glb, round(time.time() - t), "s", flush=True)
path = glb[1] if isinstance(glb, (list, tuple)) else glb
path = path if isinstance(path, str) else path.get("value") or path.get("path")
shutil.copy(path, f"fox-{int(seed)}.glb")
print("saved", f"fox-{int(seed)}.glb", os.path.getsize(f"fox-{int(seed)}.glb"))
