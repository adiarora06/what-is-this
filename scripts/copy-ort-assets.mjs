import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "node_modules", "onnxruntime-web", "dist");
const target = join(root, "public", "ort");
const assets = ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"];

await mkdir(target, { recursive: true });
await Promise.all(assets.map((asset) => copyFile(join(source, asset), join(target, asset))));

process.stdout.write(`Prepared ${assets.length} pinned ONNX Runtime assets.\n`);
