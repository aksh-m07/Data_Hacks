/**
 * Pin WASM + worker script URLs with Vite `?url` so fetches always hit the real files.
 * ORT’s default relative resolution can load index.html (`<!do`) instead of WASM (`\\0asm`).
 *
 * Paths are relative to this file → `node_modules/onnxruntime-web/dist/` (bypasses package exports).
 */
import * as ort from "onnxruntime-web";
import jsepMjsUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url";
import wasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url";

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = {
  wasm: wasmUrl,
  mjs: jsepMjsUrl,
};

export { ort };
