import type { IdentifyResponse } from "@/lib/types";

const MODEL_URL = "https://media.githubusercontent.com/media/onnx/models/main/validated/vision/classification/mobilenet/model/mobilenetv2-7.onnx";
const MODEL_INTEGRITY = "sha256-wcUTWC1Wr87/hRbHOATkhMgcaoMHEqttaCJT9KPNBC8=";
const LABELS_URL = "https://cdn.jsdelivr.net/gh/pytorch/hub@master/imagenet_classes.txt";
const LABELS_INTEGRITY = "sha256-HzhuDRy24oucLaxlHD3qaAHpitG0GhTOa7Ggk9cgafU=";
const ASSET_CACHE = "what-is-this-model-v2";

export type ModelLoadProgress = {
  phase: "checking" | "downloading" | "preparing" | "ready";
  loaded?: number;
  total?: number;
};

type BarcodeDetectorShape = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorShape;

let sessionPromise: Promise<{
  session: import("onnxruntime-web").InferenceSession;
  labels: string[];
  ort: typeof import("onnxruntime-web");
}> | null = null;
let ocrWorkerPromise: Promise<import("tesseract.js").Worker> | null = null;

async function fetchVerified(url: string, integrity: string, onProgress?: (progress: ModelLoadProgress) => void) {
  const cache = "caches" in globalThis ? await caches.open(ASSET_CACHE) : undefined;
  onProgress?.({ phase: "checking" });
  const cached = await cache?.match(url);
  const response = cached || (await fetch(url, { cache: "force-cache", credentials: "omit", integrity, referrerPolicy: "no-referrer" }));
  if (!response.ok) throw new Error(`The private recognition model could not be downloaded (${response.status}).`);
  const total = Number(response.headers.get("content-length")) || undefined;
  let buffer: ArrayBuffer;
  if (!cached && response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ phase: "downloading", loaded, total });
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    buffer = bytes.buffer;
  } else {
    buffer = await response.arrayBuffer();
  }
  if (!cached) await cache?.put(url, new Response(buffer.slice(0), { headers: response.headers }));
  return buffer;
}

async function loadSession(onProgress?: (progress: ModelLoadProgress) => void) {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const ort = await import("onnxruntime-web");
    ort.env.wasm.wasmPaths = {
      mjs: new URL("/ort/ort-wasm-simd-threaded.mjs", window.location.origin).href,
      wasm: new URL("/ort/ort-wasm-simd-threaded.wasm", window.location.origin).href,
    };
    ort.env.wasm.numThreads = 1;
    const [model, labelBytes] = await Promise.all([
      fetchVerified(MODEL_URL, MODEL_INTEGRITY, onProgress),
      fetchVerified(LABELS_URL, LABELS_INTEGRITY),
    ]);
    onProgress?.({ phase: "preparing" });
    const labels = new TextDecoder().decode(labelBytes).split(/\r?\n/).map((label) => label.trim()).filter(Boolean);
    const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
    onProgress?.({ phase: "ready" });
    return { session, labels, ort };
  })().catch((error) => {
    sessionPromise = null;
    throw error;
  });
  return sessionPromise;
}

async function imageToTensor(image: string) {
  const source = new Image();
  source.decoding = "async";
  source.src = image;
  await source.decode();
  const canvas = document.createElement("canvas");
  canvas.width = 224;
  canvas.height = 224;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The image could not be prepared for private recognition.");
  context.drawImage(source, 0, 0, 224, 224);
  const pixels = context.getImageData(0, 0, 224, 224).data;
  const tensor = new Float32Array(3 * 224 * 224);
  const mean = [0.485, 0.456, 0.406];
  const standardDeviation = [0.229, 0.224, 0.225];
  for (let pixel = 0; pixel < 224 * 224; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      tensor[channel * 224 * 224 + pixel] = (pixels[pixel * 4 + channel] / 255 - mean[channel]) / standardDeviation[channel];
    }
  }
  return tensor;
}

function topPredictions(values: Float32Array, labels: string[]) {
  const peak = Math.max(...values);
  const exponentials = Array.from(values, (value) => Math.exp(value - peak));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials
    .map((value, index) => ({ label: labels[index] || `Class ${index}`, confidence: value / total }))
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 5);
}

function humanizeLabel(label: string) {
  return label.split(",")[0].replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function categoryFor(label: string) {
  const normalized = label.toLowerCase();
  if (/\b(dog|cat|bird|fish|animal|terrier|spaniel|retriever|hound)\b/.test(normalized)) return "Animal";
  if (/\b(food|fruit|vegetable|dish|bread|cheese|pizza|coffee|wine)\b/.test(normalized)) return "Food & drink";
  if (/\b(tool|hammer|screw|drill|wrench|knife)\b/.test(normalized)) return "Tool";
  if (/\b(car|truck|bus|bike|bicycle|boat|aircraft)\b/.test(normalized)) return "Vehicle";
  if (/\b(plant|flower|tree|fungus|mushroom)\b/.test(normalized)) return "Plant & nature";
  if (/\b(shirt|shoe|coat|dress|hat|clothing)\b/.test(normalized)) return "Clothing";
  if (/\b(phone|computer|screen|keyboard|electronic)\b/.test(normalized)) return "Electronics";
  return "Everyday object";
}

export async function identifyOnDevice(
  image: string,
  context?: string,
  onProgress?: (progress: ModelLoadProgress) => void,
): Promise<Extract<IdentifyResponse, { ok: true }>> {
  const { session, labels, ort } = await loadSession(onProgress);
  const values = await imageToTensor(image);
  const inputName = session.inputNames[0];
  const results = await session.run({ [inputName]: new ort.Tensor("float32", values, [1, 3, 224, 224]) });
  const output = results[session.outputNames[0]];
  const predictions = topPredictions(output.data as Float32Array, labels);
  const best = predictions[0];
  const objectName = humanizeLabel(best.label);
  const category = categoryFor(best.label);
  return {
    ok: true,
    model: "MobileNetV2 ONNX",
    provider: "device",
    warnings: ["Private on-device recognition is broad; confirm the result before saving."],
    card: {
      objectName,
      shortName: objectName,
      confidence: best.confidence,
      category,
      about: `This looks most like ${objectName.toLowerCase()} based on a private image-classification model.${context ? ` Your note was: ${context.slice(0, 160)}.` : ""}`,
      visualClues: predictions.slice(0, 3).map((prediction) => `${humanizeLabel(prediction.label)} · ${Math.round(prediction.confidence * 100)}%`),
      useCases: ["Use this as a starting point, then confirm or correct the identification."],
      careTips: ["Check labels or markings when an exact model, material, or species matters."],
      purchaseQuery: objectName,
      purchaseLinks: [],
      shoppingRecommended: false,
      source: "on-device",
      alternatives: predictions.slice(1).map((prediction) => ({ ...prediction, label: humanizeLabel(prediction.label), source: "on-device" })),
    },
  };
}

export async function detectBarcode(image: string) {
  const Detector = (globalThis as typeof globalThis & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  if (!Detector) return undefined;
  try {
    const detector = new Detector();
    const source = new Image();
    source.src = image;
    await source.decode();
    const results = await detector.detect(source);
    return results.find((result) => result.rawValue)?.rawValue?.slice(0, 160);
  } catch {
    return undefined;
  }
}

export async function extractText(image: string, onProgress?: (progress: number) => void) {
  const { createWorker } = await import("tesseract.js");
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker("eng", undefined, {
      logger: (event) => {
        if (event.status === "recognizing text") onProgress?.(event.progress);
      },
    }).catch((error) => {
      ocrWorkerPromise = null;
      throw error;
    });
  }
  const worker = await ocrWorkerPromise;
  const result = await worker.recognize(image);
  return result.data.text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 1)
    .slice(0, 8)
    .map((line) => line.slice(0, 240));
}

export async function clearPrivateModelCache() {
  sessionPromise = null;
  if (ocrWorkerPromise) {
    const worker = await ocrWorkerPromise;
    await worker.terminate();
    ocrWorkerPromise = null;
  }
  if ("caches" in globalThis) await caches.delete(ASSET_CACHE);
}

export async function privateModelReady() {
  if (sessionPromise) return true;
  if (!("caches" in globalThis)) return false;
  const cache = await caches.open(ASSET_CACHE);
  return Boolean(await cache.match(MODEL_URL));
}
