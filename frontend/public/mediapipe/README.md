Self-hosted MediaPipe assets, so a candidate's browser never contacts a third-party CDN.

- `blaze_face_short_range.tflite`: BlazeFace short-range face detector (Apache-2.0, Google), fetched from
  `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/`.
  SHA-256 `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f`. The upstream URL is
  unversioned ("latest"), so this pinned copy is also what makes the model reproducible.
- `wasm/` is generated from `node_modules/@mediapipe/tasks-vision` by `scripts/copy-mediapipe.mjs`
  (run by `predev` and `prebuild`) and is not committed.
