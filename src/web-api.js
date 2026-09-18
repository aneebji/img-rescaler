import JSZip from "jszip";

const filesById = new Map();
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

function fileBase(name) {
  const slash = name.lastIndexOf("/");
  const base = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function uniqueName(used, name) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }

  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let suffix = 2;
  let next = `${stem}-${suffix}${ext}`;

  while (used.has(next)) {
    suffix += 1;
    next = `${stem}-${suffix}${ext}`;
  }

  used.add(next);
  return next;
}

function coverCrop(srcW, srcH, aspect) {
  const imageAspect = srcW / srcH;
  let width;
  let height;

  if (imageAspect > aspect) {
    height = srcH;
    width = srcH * aspect;
  } else {
    width = srcW;
    height = srcW / aspect;
  }

  return {
    left: (srcW - width) / 2,
    top: (srcH - height) / 2,
    width,
    height,
  };
}

function integerCrop(crop, srcW, srcH) {
  let left = Math.max(0, Math.round(crop.left));
  let top = Math.max(0, Math.round(crop.top));
  let width = Math.max(1, Math.round(crop.width));
  let height = Math.max(1, Math.round(crop.height));

  if (left + width > srcW) {
    width = srcW - left;
  }
  if (top + height > srcH) {
    height = srcH - top;
  }

  return {
    left,
    top,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

function normalizeCrop(crop, srcW, srcH, targetW, targetH) {
  if (!srcW || !srcH) {
    throw new Error("Could not read image size");
  }

  const fallback = coverCrop(srcW, srcH, targetW / targetH);
  const source = crop && crop.width > 0 && crop.height > 0 ? crop : fallback;
  return integerCrop(source, srcW, srcH);
}

function emitProgress(data) {
  for (const listener of progressListeners) {
    listener(data);
  }
}

async function decodeBitmap(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      return createImageBitmap(file);
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
      const bitmap = await decodeBitmap(file);
      const { width, height } = bitmapSize(bitmap);
      if (typeof bitmap.close === "function") {
        bitmap.close();
      }

      if (!width || !height) {
        throw new Error("Could not read image size");
      }

      filesById.set(id, file);
      infos.push({
        id,
        path: id,
        name,
        width,
        height,
      });
    } catch (error) {
      infos.push({
        id,
        path: id,
        name,
        width: 0,
        height: 0,
        error: error.message || "Could not read image",
      });
    }
  }

  return infos;
}

function openFilePicker() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "image/*";
    input.addEventListener(
      "change",
      () => {
        resolve([...(input.files || [])]);
      },
      { once: true }
    );
    input.click();
  });
}

async function getImagePreview(id) {
  const file = filesById.get(id);
  if (!file) {
    throw new Error("Image is no longer available");
  }

  const bitmap = await decodeBitmap(file);
  const { width, height } = bitmapSize(bitmap);
  if (!width || !height) {
    if (typeof bitmap.close === "function") {
      bitmap.close();
    }
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
  ctx.drawImage(bitmap, 0, 0, previewWidth, previewHeight);
  if (typeof bitmap.close === "function") {
    bitmap.close();
  }

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.86),
    width,
    height,
    previewWidth,
    previewHeight,
  };
}

async function cropToPng(file, crop, targetW, targetH) {
  const bitmap = await decodeBitmap(file);
  const { width, height } = bitmapSize(bitmap);
  const region = normalizeCrop(crop, width, height, targetW, targetH);
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    bitmap,
    region.left,
    region.top,
    region.width,
    region.height,
    0,
    0,
    targetW,
    targetH
  );
  if (typeof bitmap.close === "function") {
    bitmap.close();
  }

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((next) => {
      if (next) {
        resolve(next);
      } else {
        reject(new Error("Could not encode PNG"));
      }
    }, "image/png");
  });

  return blob;
}

async function resizeImages({ images, resolutions, crops }) {
  const stamp = formatRunStamp();
  const folder = `ImageRescaler_${stamp}`;
  const zip = new JSZip();
  const usedOriginals = new Set();
  const results = [];
  const jobs = [];

  for (const image of images) {
    for (const resolution of resolutions) {
      jobs.push({ image, resolution });
    }
  }

  for (const image of images) {
    const file = filesById.get(image.id || image.path);
    if (!file) {
      continue;
    }
    const originalName = uniqueName(usedOriginals, image.name || file.name || "image");
    zip.file(`${folder}/originals/${originalName}`, file);
  }

  for (let index = 0; index < jobs.length; index += 1) {
    const { image, resolution } = jobs[index];
    const presetWidth = Number(resolution.width);
    const presetHeight = Number(resolution.height);
    const key = `${presetWidth}x${presetHeight}`;
    const imageKey = image.id || image.path;

    emitProgress({
      current: index + 1,
      total: jobs.length,
      file: image.name,
      preset: key,
    });

    try {
      const file = filesById.get(imageKey);
      if (!file) {
        throw new Error("Image is no longer available");
      }

      const crop = crops?.[imageKey]?.[key] || crops?.[image.path]?.[key];
      const blob = await cropToPng(file, crop, presetWidth, presetHeight);
      const outputName = `${fileBase(image.name)}_${presetWidth}x${presetHeight}.png`;
      const outputPath = `${folder}/${outputName}`;
      zip.file(outputPath, blob);
      results.push({
        source: image.name,
        presetWidth,
        presetHeight,
        outputPath,
        width: presetWidth,
        height: presetHeight,
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
        error: error.message || "Resize failed",
      });
    }
  }

  emitProgress({
    current: jobs.length,
    total: jobs.length,
    file: "",
    preset: "",
    done: true,
  });

  const zipBlob = await zip.generateAsync({ type: "blob" });
  const href = URL.createObjectURL(zipBlob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `${folder}.zip`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 30_000);

  return { outputDir: folder, results };
}

export function installWebApi() {
  if (window.api) {
    return;
  }

  window.api = {
    isWeb: true,
    getDefaultOutput: async () => "ZIP download",
    pickImages: async () => inspectFiles(await openFilePicker()),
    inspectFiles: (fileList) => inspectFiles(fileList),
    inspectPaths: async () => [],
    getImagePreview,
    pickOutputFolder: async () => null,
    revealItem: () => {},
    revealFolder: () => {},
    resizeImages,
    getPathForFile: () => "",
    releaseImage: (id) => {
      filesById.delete(id);
    },
    onResizeProgress: (callback) => {
      progressListeners.add(callback);
      return () => progressListeners.delete(callback);
    },
  };
}
