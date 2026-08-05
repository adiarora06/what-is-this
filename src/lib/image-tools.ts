const MAX_FINGERPRINT_DISTANCE = 6;
const STRICT_FINGERPRINT_DISTANCE = 4;

export const MAX_UPLOAD_FILE_BYTES = 15_000_000;
export const SUPPORTED_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type FrameCandidate = { image: string; score: number };

export function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function fileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("The selected image could not be read."));
    reader.readAsDataURL(file);
  });
}

export async function resizeImageDataUrl(image: string, maxDimension: number, quality: number) {
  if (!image.startsWith("data:image/")) return undefined;
  return new Promise<string | undefined>((resolve) => {
    const source = new Image();
    source.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(source.naturalWidth, source.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) return resolve(undefined);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    source.onerror = () => resolve(undefined);
    source.src = image;
  });
}

export function makeFeedbackThumbnail(image: string) {
  return resizeImageDataUrl(image, 360, 0.68);
}

export function waitForVideoReady(video: HTMLVideoElement, timeoutMs = 6_000) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("The camera took too long to start. Try again."));
    }, timeoutMs);
    const handleReady = () => {
      if (!video.videoWidth || !video.videoHeight) return;
      cleanup();
      resolve();
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", handleReady);
    };
    video.addEventListener("loadeddata", handleReady);
  });
}

function scoreFrame(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return 0;
  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  const stride = Math.max(8, Math.floor(Math.min(width, height) / 70));
  let edgeScore = 0;
  let brightnessTotal = 0;
  let samples = 0;

  for (let y = stride; y < height - stride; y += stride) {
    for (let x = stride; x < width - stride; x += stride) {
      const i = (y * width + x) * 4;
      const right = (y * width + x + stride) * 4;
      const down = ((y + stride) * width + x) * 4;
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const rightGray = data[right] * 0.299 + data[right + 1] * 0.587 + data[right + 2] * 0.114;
      const downGray = data[down] * 0.299 + data[down + 1] * 0.587 + data[down + 2] * 0.114;
      edgeScore += Math.abs(gray - rightGray) + Math.abs(gray - downGray);
      brightnessTotal += gray;
      samples += 1;
    }
  }

  const brightness = brightnessTotal / Math.max(1, samples);
  return edgeScore / Math.max(1, samples) - Math.abs(132 - brightness) * 0.9;
}

export function captureVideoFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): FrameCandidate | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const scale = Math.min(1, 1100 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return { image: canvas.toDataURL("image/jpeg", 0.82), score: scoreFrame(canvas) };
}

async function imagePixels(image: string, width: number, height: number) {
  if (!image.startsWith("data:image/")) return undefined;
  return new Promise<ImageData | undefined>((resolve) => {
    const source = new Image();
    source.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return resolve(undefined);
      context.drawImage(source, 0, 0, width, height);
      resolve(context.getImageData(0, 0, width, height));
    };
    source.onerror = () => resolve(undefined);
    source.src = image;
  });
}

export async function imageFingerprint(image: string) {
  const imageData = await imagePixels(image, 9, 8);
  if (!imageData) return undefined;
  const pixels = imageData.data;
  let bits = "";
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = (y * 9 + x) * 4;
      const right = left + 4;
      const leftGray = pixels[left] * 0.299 + pixels[left + 1] * 0.587 + pixels[left + 2] * 0.114;
      const rightGray = pixels[right] * 0.299 + pixels[right + 1] * 0.587 + pixels[right + 2] * 0.114;
      bits += leftGray > rightGray ? "1" : "0";
    }
  }
  return Array.from({ length: 16 }, (_, index) => Number.parseInt(bits.slice(index * 4, index * 4 + 4), 2).toString(16)).join("");
}

export async function imageVisualSignature(image: string) {
  const imageData = await imagePixels(image, 8, 8);
  if (!imageData) return undefined;
  const signature: number[] = [];
  const pixels = imageData.data;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index] / 255;
    const green = pixels[index + 1] / 255;
    const blue = pixels[index + 2] / 255;
    signature.push(Number((red * 0.299 + green * 0.587 + blue * 0.114).toFixed(4)));
  }
  const magnitude = Math.hypot(...signature) || 1;
  return signature.map((value) => Number((value / magnitude).toFixed(5)));
}

export function fingerprintDistance(left: string, right: string) {
  if (left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const difference = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    distance += difference.toString(2).replaceAll("0", "").length;
  }
  return distance;
}

export function signatureSimilarity(left?: number[], right?: number[]) {
  if (!left?.length || left.length !== right?.length) return 0;
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

export function visuallySimilar(
  fingerprint: string | undefined,
  storedFingerprint: string | undefined,
  signature: number[] | undefined,
  storedSignature: number[] | undefined,
) {
  const hasHashPair = Boolean(fingerprint && storedFingerprint);
  const hasSignaturePair = Boolean(signature?.length && storedSignature?.length);
  const hashDistance = hasHashPair ? fingerprintDistance(fingerprint!, storedFingerprint!) : Number.POSITIVE_INFINITY;
  const similarity = hasSignaturePair ? signatureSimilarity(signature, storedSignature) : 0;
  if (hasHashPair && hasSignaturePair) return hashDistance <= MAX_FINGERPRINT_DISTANCE && similarity >= 0.99;
  if (hasHashPair) return hashDistance <= STRICT_FINGERPRINT_DISTANCE;
  if (hasSignaturePair) return similarity >= 0.995;
  return false;
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
