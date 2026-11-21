// Serves MediaPipe's WASM runtime from our own origin (no CDN request, JS and WASM versions always match).
import { cpSync, mkdirSync } from "node:fs";

const from = new URL("../node_modules/@mediapipe/tasks-vision/wasm", import.meta.url);
const to = new URL("../public/mediapipe/wasm", import.meta.url);
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
