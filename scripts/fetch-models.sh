#!/usr/bin/env bash
# Vendor the MediaPipe models and wasm runtime so the demo runs without a
# network connection. After running this, point src/config.js at the local
# copies (see README).
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION="0.10.18"
mkdir -p vendor/models vendor/wasm

echo "==> models"
curl -fL --progress-bar \
  -o vendor/models/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
curl -fL --progress-bar \
  -o vendor/models/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task

echo "==> tasks-vision ${VERSION}"
for f in vision_bundle.mjs \
         wasm/vision_wasm_internal.js wasm/vision_wasm_internal.wasm \
         wasm/vision_wasm_nosimd_internal.js wasm/vision_wasm_nosimd_internal.wasm; do
  mkdir -p "vendor/$(dirname "$f")"
  curl -fL --progress-bar \
    -o "vendor/$f" \
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/${f}"
done

cat <<'MSG'

Done. Now edit src/config.js so CONFIG starts with these four paths
(they are resolved relative to src/):

  visionModule: '../vendor/vision_bundle.mjs',
  wasmBase:     '../vendor/wasm',
  faceModel:    '../vendor/models/face_landmarker.task',
  handModel:    '../vendor/models/hand_landmarker.task',

MSG
