import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["onnxruntime-web", "onnxruntime-common"],
  },
  assetsInclude: ["**/*.wasm"],
  optimizeDeps: {
    include: [
      "onnxruntime-web",
      "onnxruntime-common",
      "@tensorflow/tfjs",
      "@tensorflow-models/coco-ssd",
    ],
  },
});
