import type { Tensor } from "onnxruntime-web";
import { calibrateRiskScore } from "./scoreCalibration";
import { ort } from "./ortEnv";

let sessionPromise: Promise<ort.InferenceSession> | null = null;

const MODEL_PATH = `${import.meta.env.BASE_URL}models/wildfire_risk.onnx`;

async function createSession(): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
}

async function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = createSession();
  }
  try {
    return await sessionPromise;
  } catch (e) {
    sessionPromise = null;
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`ONNX session failed to load: ${msg}`);
  }
}

/** Clears cached session after load/run errors (e.g. backend registration issues). */
export function resetInferenceSession(): void {
  sessionPromise = null;
}

async function firstOutputValue(output: Tensor): Promise<{ v: number; dims: number[] }> {
  const t = output as ort.Tensor;
  const dims = [...(t.dims ?? [])];
  let data: Float32Array;
  try {
    data = t.data as Float32Array;
    if (!data || data.length === 0) {
      data = (await t.getData()) as Float32Array;
    }
  } catch {
    data = (await t.getData()) as Float32Array;
  }
  const v = data.length ? data[0]! : 0;
  return { v, dims };
}

export type PredictResult = {
  score: number;
  /** Raw regressor output before 0–100 clamp (use to verify the model is not stuck). */
  rawScore: number;
  outputDims: number[];
  error?: string;
};

export async function predictRisk(input11: Float32Array): Promise<PredictResult> {
  try {
    const session = await getSession();
    const inName = session.inputNames[0];
    const tensor = new ort.Tensor("float32", input11, [1, 11]);
    const feeds: Record<string, ort.Tensor> = { [inName]: tensor };
    const out = await session.run(feeds);
    const outName = session.outputNames[0];
    const output = out[outName];
    if (!output) {
      return { score: 0, rawScore: 0, outputDims: [], error: "Model returned no output tensor" };
    }
    const { v, dims } = await firstOutputValue(output as Tensor);
    return {
      score: calibrateRiskScore(v),
      rawScore: v,
      outputDims: dims,
    };
  } catch (e) {
    resetInferenceSession();
    return {
      score: 0,
      rawScore: 0,
      outputDims: [],
      error: e instanceof Error ? e.message : "Inference failed",
    };
  }
}

export async function loadFeatureImportances(): Promise<number[] | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}models/feature_importances.json`);
    if (!r.ok) return null;
    return (await r.json()) as number[];
  } catch {
    return null;
  }
}
