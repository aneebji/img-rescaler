import JSZip from "jszip";
import {
  normalizeCrop,
  normalizeExportOptions,
  outputFileName,
  safeFileName,
  uniqueName,
  validateResolutions,
} from "./export-utils.mjs";
import { decodePsdComposite, isPsdFileName } from "../electron/psd-decode.mjs";

const filesById = new Map();
const bitmapsById = new Map();
const progressListeners = new Set();

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatRunStamp(date = new Date()) {
  return [
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    `${pad2(date.getHours())}-${pad2(date.getMinutes())}-${pad2(date.getSeconds())}`,
  ].join("_");
}

function emitProgress(data) {
  for (const listener of progressListeners) {
    // A failed UI listener must not interrupt an export or other listeners.
    try {
      listener(data);
    } catch (error) {
      console.error("Progress listener failed", error);
    }
  }
}

async function decodeBitmap(file) {
  if (isPsdFileName(file.name)) {
    const { width, height, rgba } = decodePsdComposite(await file.arrayBuffer());
    return createImageBitmap(new ImageData(rgba, width, height));
  }

  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      try {
        return await createImageBitmap(file);
      } catch {
        // Some browsers decode formats such as SVG only through an Image element.
      }
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function bitmapForId(id) {
  const cached = bitmapsById.get(id);
  if (cached) {
    return cached;
  }

  const file = filesById.get(id);
  if (!file) {
    throw new Error("Image is no longer available. Add it again to export.");
  }

  const bitmap = await decodeBitmap(file);
  bitmapsById.set(id, bitmap);
  return bitmap;
}

function bitmapSize(bitmap) {
  return {
    width: bitmap.naturalWidth || bitmap.width || 0,
    height: bitmap.naturalHeight || bitmap.height || 0,
  };
}

async function inspectFiles(fileList) {
  const infos = [];

  for (const file of fileList) {
    if (!file) {
      continue;
    }

    const id = `web:${crypto.randomUUID()}`;
    const name = file.name || "image";

    try {
      filesById.set(id, file);
      const bitmap = await bitmapForId(id);
      const { width, height } = bitmapSize(bitmap);

      if (!width || !height) {
        throw new Error("Could not read image size");
      }
      infos.push({
        id,
        path: id,
        name,
        width,
        height,
        size: file.size,
      });
    } catch (error) {
      infos.push({
        id,
        path: id,
        name,
        width: 0,
        height: 0,
        size: file.size,
        error: error.message || "Could not read image",
      });
    }
  }

  return infos;
}

async function loadSampleImage() {
  const response = await fetch(new URL("./sample.svg", window.location.href));
  if (!response.ok)
    throw new Error(
      "The sample image could not be loaded. Add your own image to continue.",
    );
  const file = new File([await response.blob()], "quiet-landscape.svg", {
    type: "image/svg+xml",
  });
  return inspectFiles([file]);
}

function openFilePicker() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "image/*,.psd,.psb";
    input.hidden = true;
    let settled = false;
    let focusTimer;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(focusTimer);
      window.removeEventListener("focus", onFocus);
      const files = [...(input.files || [])];
      input.remove();
      resolve(files);
    };
    // Older browsers may not dispatch the input cancel event.
    const onFocus = () => {
      focusTimer = window.setTimeout(finish, 500);
    };
    input.addEventListener("change", finish, { once: true });
    input.addEventListener("cancel", finish, { once: true });
    window.addEventListener("focus", onFocus, { once: true });
    document.body.append(input);
    input.click();
  });
}

async function getImagePreview(id) {
  const bitmap = await bitmapForId(id);
  const { width, height } = bitmapSize(bitmap);
  if (!width || !height) {
    throw new Error("Could not read image size");
  }

  const max = 1600;
  let previewWidth = width;
  let previewHeight = height;
  if (width > max || height > max) {
    const scale = max / Math.max(width, height);
    previewWidth = Math.max(1, Math.round(width * scale));
    previewHeight = Math.max(1, Math.round(height * scale));
  }

  const canvas = document.createElement("canvas");
  canvas.width = previewWidth;
  canvas.height = previewHeight;
  const ctx = canvas.getContext("2d");
  try {
    if (!ctx)
      throw new Error("Your browser could not create an image preview.");
    ctx.drawImage(bitmap, 0, 0, previewWidth, previewHeight);
  } finally {
    // Keep the decoded bitmap cached for export; do not close it here.
  }

  return {
    dataUrl: canvas.toDataURL("image/png"),
    width,
    height,
    previewWidth,
    previewHeight,
  };
}

async function cropToImage(id, crop, targetW, targetH, { format, quality }) {
  const bitmap = await bitmapForId(id);
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  try {
    const { width, height } = bitmapSize(bitmap);
    const region = normalizeCrop(crop, width, height, targetW, targetH);
    const ctx = canvas.getContext("2d");
    if (!ctx)
      throw new Error("Your browser could not create an export canvas.");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (format === "jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, targetW, targetH);
    }
    ctx.drawImage(
      bitmap,
      region.left,
      region.top,
      region.width,
      region.height,
      0,
      0,
      targetW,
      targetH,
    );
    const mime = `image/${format}`;
    return await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(
              new Error(
                `Could not encode ${format.toUpperCase()}. Try a smaller output size.`,
              ),
            );
          } else if (blob.type !== mime) {
            reject(
              new Error(
                `This browser cannot export ${format.toUpperCase()}. Choose PNG or JPEG.`,
              ),
            );
          } else {
            resolve(blob);
          }
        },
        mime,
        quality,
      );
    });
  } finally {
    // Keep the cached bitmap for other sizes; releaseImage closes it.
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function resizeImages(payload = {}) {
  const { images, crops } = payload;
  const options = normalizeExportOptions(payload);
  const resolutions = validateResolutions(payload.resolutions);
  if (
    !Array.isArray(images) ||
    !images.length ||
    images.some((item) => !item || typeof (item.id || item.path) !== "string")
  ) {
    throw new Error("Add at least one valid image to export.");
  }
  const folder = `ImageRescaler_${formatRunStamp()}`;
  const zip = new JSZip();
  const usedOriginals = new Set();
  const usedOutputs = new Set();
  const results = [];
  const jobs = images.flatMap((image) =>
    resolutions.map((resolution) => ({ image, resolution })),
  );
  const progress = (data) =>
    emitProgress({
      total: jobs.length,
      file: "",
      preset: "",
      done: false,
      ...data,
    });
  progress({ phase: "preparing", current: 0, percent: 0 });

  if (options.includeOriginals) {
    const seen = new Set();
    for (const image of images) {
      const imageKey = image.id || image.path;
      const file = filesById.get(imageKey);
      if (!file || seen.has(imageKey)) continue;
      seen.add(imageKey);
      const originalName = uniqueName(
        usedOriginals,
        safeFileName(image.name || file.name || "image"),
      );
      zip.file(`${folder}/originals/${originalName}`, file);
    }
  }

  for (let index = 0; index < jobs.length; index += 1) {
    const { image, resolution } = jobs[index];
    const presetWidth = resolution.width;
    const presetHeight = resolution.height;
    const key = `${presetWidth}x${presetHeight}`;
    const imageKey = image.id || image.path;
    progress({
      phase: "resizing",
      current: index,
      percent: (index / jobs.length) * 88,
      file: image.name,
      preset: key,
    });

    try {
      const file = filesById.get(imageKey);
      if (!file)
        throw new Error(
          "Image is no longer available. Add it again to export.",
        );
      const crop = crops?.[imageKey]?.[key] || crops?.[image.path]?.[key];
      const blob = await cropToImage(
        imageKey,
        crop,
        presetWidth,
        presetHeight,
        options,
      );
      const outputName = uniqueName(
        usedOutputs,
        outputFileName(
          image.name || file.name,
          presetWidth,
          presetHeight,
          options.format,
        ),
      );
      const outputPath = `${folder}/${outputName}`;
      zip.file(outputPath, blob);
      results.push({
        source: image.name,
        presetWidth,
        presetHeight,
        outputPath,
        width: presetWidth,
        height: presetHeight,
        format: options.format,
        size: blob.size,
        error: null,
      });
    } catch (error) {
      results.push({
        source: image.name,
        presetWidth,
        presetHeight,
        outputPath: null,
        width: null,
        height: null,
        format: options.format,
        size: 0,
        error: error.message || "Resize failed",
      });
    }
    progress({
      phase: "resizing",
      current: index + 1,
      percent: ((index + 1) / jobs.length) * 88,
      file: image.name,
      preset: key,
    });
    // Give the browser a chance to paint progress between jobs.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  progress({ phase: "packaging", current: jobs.length, percent: 88 });
  const zipBlob = await zip.generateAsync({ type: "blob" }, (metadata) => {
    progress({
      phase: "packaging",
      current: jobs.length,
      percent: Math.min(99, 88 + metadata.percent * 0.11),
    });
  });
  const href = URL.createObjectURL(zipBlob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `${folder}.zip`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
  progress({
    phase: "complete",
    current: jobs.length,
    percent: 100,
    done: true,
  });
  return { outputDir: folder, results, size: zipBlob.size };
}

export function installWebApi() {
  if (window.api) {
    return;
  }

  window.api = {
    isWeb: true,
    getDefaultOutput: async () => "ZIP download",
    pickImages: async () => inspectFiles(await openFilePicker()),
    loadSampleImage,
    inspectFiles: (fileList) => inspectFiles(fileList),
    inspectPaths: async () => [],
    getImagePreview,
    pickOutputFolder: async () => null,
    revealItem: () => {},
    revealFolder: () => {},
    resizeImages,
    getPathForFile: () => "",
    releaseImage: (id) => {
      const bitmap = bitmapsById.get(id);
      if (bitmap && typeof bitmap.close === "function") {
        bitmap.close();
      }
      bitmapsById.delete(id);
      filesById.delete(id);
    },
    onResizeProgress: (callback) => {
      progressListeners.add(callback);
      return () => progressListeners.delete(callback);
    },
  };
}
