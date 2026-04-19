#!/usr/bin/env python3
"""
Sanity-check wildfire_risk.onnx: print outputs for a few synthetic inputs.

If every scenario prints ~11–12, the model weights are saturated low (retrain or expect low scores).
If extremes differ widely, the pipeline is fine — low live scores reflect mild weather.

Usage (from repo root):

  python3 -m venv .venv
  .venv/bin/pip install -r scripts/requirements.txt
  .venv/bin/python scripts/verify_onnx_risk.py
"""

from __future__ import annotations

import math
import os
import sys

import numpy as np


def main() -> None:
    try:
        import onnxruntime as ort
    except ImportError:
        print("Install onnxruntime: pip install onnxruntime", file=sys.stderr)
        sys.exit(1)

    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    path = os.path.join(root, "public", "models", "wildfire_risk.onnx")
    if not os.path.isfile(path):
        print(f"Missing model: {path}", file=sys.stderr)
        sys.exit(1)

    sess = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    inp = sess.get_inputs()[0]
    in_name = inp.name
    print(f"Input: {in_name} shape={inp.shape}")
    for o in sess.get_outputs():
        print(f"Output: {o.name} shape={o.shape}")

    def cal(v: float) -> float:
        return max(0.0, min(100.0, 14.0 + v * 3.5))

    def run(label: str, x: np.ndarray) -> None:
        out = sess.run(None, {in_name: x.astype(np.float32)})
        v = float(np.array(out[0]).flatten()[0])
        print(f"  {label}: raw = {v:.6f}  →  calibrated = {cal(v):.2f}")

    z = np.zeros((1, 11), dtype=np.float32)
    o = np.ones((1, 11), dtype=np.float32)

    # Order matches src/lib/features.ts toModelInput
    wd = 225.0
    high_fire = np.array(
        [
            [
                110 / 120,
                0.10,
                115 / 130,
                55 / 60,
                math.sin(math.radians(wd)),
                math.cos(math.radians(wd)),
                0.85,
                0.92,
                0.5,
                5 / 11,
                80 / 800,
            ]
        ],
        dtype=np.float32,
    )

    mild = np.array(
        [
            [
                72 / 120,
                0.55,
                75 / 130,
                5 / 60,
                math.sin(math.radians(180)),
                math.cos(math.radians(180)),
                0.12,
                0.35,
                0.45,
                3 / 11,
                400 / 800,
            ]
        ],
        dtype=np.float32,
    )

    print("\nSynthetic batches:")
    run("zeros", z)
    run("ones", o)
    run("mild weather-ish", mild)
    run("extreme hot / dry / wind / near fire", high_fire)


if __name__ == "__main__":
    main()
