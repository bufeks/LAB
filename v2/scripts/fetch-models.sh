#!/usr/bin/env bash
# Vendor the MediaPipe runtime and models so BREAK TO CREATE runs without a
# network connection. After running this, point v2/src/config.js at the local
# copies (see v2/README.md).
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION="0.10.18"
mkdir -p vendor/models vendor/wasm

echo "==> models"
curl -fL --progress-bar -o vendor/models/face_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
curl -fL --progress-bar -o vendor/models/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
curl -fL --progress-bar -o vendor/models/selfie_segmenter.tflite \
  https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite

echo "==> tasks-vision ${VERSION}"
for f in vision_bundle.mjs \
         wasm/vision_wasm_internal.js wasm/vision_wasm_internal.wasm \
         wasm/vision_wasm_nosimd_internal.js wasm/vision_wasm_nosimd_internal.wasm; do
  mkdir -p "vendor/$(dirname "$f")"
  curl -fL --progress-bar -o "vendor/$f" \
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/${f}"
done

cat <<'MSG'

Done. Now edit v2/src/config.js so CONFIG starts with these five paths
(they are resolved relative to v2/src/):

  visionModule:   '../vendor/vision_bundle.mjs',
  wasmBase:       '../vendor/wasm',
  faceModel:      '../vendor/models/face_landmarker.task',
  handModel:      '../vendor/models/hand_landmarker.task',
  segmentModel:   '../vendor/models/selfie_segmenter.tflite',

MSG
