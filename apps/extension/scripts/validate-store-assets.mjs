#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const extensionDirectory = resolve(scriptDirectory, "..");
const requiredAssets = new Map([
  ["icons/icon-128-store.png", [128, 128]],
  ["store-assets/screenshot-01-capture-1280x800.png", [1280, 800]],
  ["store-assets/screenshot-02-guide-1280x800.png", [1280, 800]],
  ["store-assets/screenshot-03-clarification-1280x800.png", [1280, 800]],
  ["store-assets/small-promo-440x280.png", [440, 280]],
]);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function fail(message) {
  throw new Error(message);
}

function parsePng(bytes, relativePath) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(pngSignature)) {
    fail(`${relativePath} is not a valid PNG file.`);
  }

  let offset = 8;
  let header = null;
  const imageData = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) fail(`${relativePath} has a truncated ${type} chunk.`);
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "IDAT") {
      imageData.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (!header || imageData.length === 0) fail(`${relativePath} is missing required PNG chunks.`);
  return { ...header, imageData };
}

function paeth(left, up, upperLeft) {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function rgbaRows(png, relativePath) {
  if (png.bitDepth !== 8 || png.colorType !== 6 || png.interlace !== 0) {
    fail(`${relativePath} must be a non-interlaced 8-bit RGBA PNG.`);
  }
  const bytesPerPixel = 4;
  const stride = png.width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(png.imageData));
  if (inflated.length !== (stride + 1) * png.height) fail(`${relativePath} has unexpected decoded data length.`);

  const rows = [];
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < png.height; y += 1) {
    const offset = y * (stride + 1);
    const filter = inflated[offset];
    const source = inflated.subarray(offset + 1, offset + 1 + stride);
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = previous[x];
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : filter === 4 ? paeth(left, up, upperLeft)
                : fail(`${relativePath} uses unsupported PNG filter ${filter}.`);
      row[x] = (source[x] + predictor) & 0xff;
    }
    rows.push(row);
    previous = row;
  }
  return rows;
}

function validateIconPadding(png, relativePath) {
  const rows = rgbaRows(png, relativePath);
  let minX = png.width;
  let minY = png.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (rows[y][x * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (minX !== 16 || minY !== 16 || maxX !== 111 || maxY !== 111) {
    fail(`${relativePath} artwork must have exactly 16 px transparent padding; found bounds ${minX},${minY}–${maxX},${maxY}.`);
  }
}

for (const [relativePath, [expectedWidth, expectedHeight]] of requiredAssets) {
  const bytes = await readFile(join(extensionDirectory, relativePath));
  const png = parsePng(bytes, relativePath);
  if (png.width !== expectedWidth || png.height !== expectedHeight) {
    fail(`${relativePath} must be ${expectedWidth}×${expectedHeight}; found ${png.width}×${png.height}.`);
  }
  if (relativePath === "icons/icon-128-store.png") validateIconPadding(png, relativePath);
}

console.log(`Validated ${requiredAssets.size} Chrome Web Store image assets and the 16 px icon safe area.`);
