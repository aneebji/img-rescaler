export const MAX_OUTPUT_SIDE = 8192;
export const MAX_OUTPUT_PIXELS = 32_000_000;
export const MAX_EXPORT_BYTES = 2 * 1024 * 1024;

function readByteLength(encoded) {
  if (
    !encoded ||
    !Number.isFinite(encoded.byteLength) ||
    encoded.byteLength < 0
  ) {
    throw new Error("Encoder did not report a file size.");
  }
  return encoded.byteLength;
}

export async function largestWithinByteLimit(
  encode,
  min,
  max,
  maxBytes = MAX_EXPORT_BYTES,
) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    throw new Error("Export fit range is invalid.");
  }
  const atMax = await encode(max);
  if (readByteLength(atMax) <= maxBytes) return { value: max, ...atMax };
  if (min === max) return null;

  const atMin = await encode(min);
  if (readByteLength(atMin) > maxBytes) return null;

  const integer = Number.isInteger(min) && Number.isInteger(max);
  let low = min;
  let high = integer ? max - 1 : max;
  let best = { value: min, ...atMin };

  for (let step = 0; step < 8; step += 1) {
    if (integer ? high <= low : high - low < 0.015) break;
    const mid = integer ? Math.ceil((low + high) / 2) : (low + high) / 2;
    if (mid <= low || mid > high) break;
    const candidate = await encode(mid);
    if (readByteLength(candidate) <= maxBytes) {
      best = { value: mid, ...candidate };
      low = mid;
    } else if (integer) {
      high = mid - 1;
    } else {
      high = mid;
    }
  }

  return best;
}

export function scaledDimensions(width, height, scale) {
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function fitExport({
  width,
  height,
  format,
  quality = 0.9,
  encode,
  allowPalette = false,
  maxBytes = MAX_EXPORT_BYTES,
}) {
  const lossy = format === "jpeg" || format === "webp";
  const requested = Math.max(1, Math.min(100, Math.round(quality * 100)));
  if (maxBytes == null) {
    const encoded = await encode(width, height, lossy ? requested : null);
    return { ...encoded, width, height };
  }

  const atSize = async (targetWidth, targetHeight) => {
    if (!lossy) {
      const lossless = await encode(targetWidth, targetHeight, null);
      if (readByteLength(lossless) <= maxBytes) {
        return { ...lossless, width: targetWidth, height: targetHeight };
      }
      if (allowPalette) {
        const paletted = await largestWithinByteLimit(
          (level) => encode(targetWidth, targetHeight, level),
          1,
          100,
          maxBytes,
        );
        if (paletted) {
          return { ...paletted, width: targetWidth, height: targetHeight };
        }
      }
      return { ...lossless, width: targetWidth, height: targetHeight };
    }

    const fitted = await largestWithinByteLimit(
      (level) => encode(targetWidth, targetHeight, level),
      1,
      requested,
      maxBytes,
    );
    if (fitted) return { ...fitted, width: targetWidth, height: targetHeight };
    const smallest = await encode(targetWidth, targetHeight, 1);
    return { ...smallest, width: targetWidth, height: targetHeight };
  };

  const full = await atSize(width, height);
  if (readByteLength(full) <= maxBytes) return full;
  if (width <= 1 && height <= 1) {
    throw new Error("Could not export this image under 2 MB.");
  }

  const minScale = 1 / Math.max(width, height);
  const highScale = Math.min(
    width > 1 ? (width - 1) / width : 1,
    height > 1 ? (height - 1) / height : 1,
  );
  const tightSetting = lossy || allowPalette ? 1 : null;
  const scaled = await largestWithinByteLimit(
    async (scale) => {
      const size = scaledDimensions(width, height, scale);
      const encoded = await encode(size.width, size.height, tightSetting);
      return {
        byteLength: encoded.byteLength,
        payload: encoded.payload,
        width: size.width,
        height: size.height,
      };
    },
    minScale,
    Math.max(minScale, highScale),
    maxBytes,
  );
  if (!scaled || readByteLength(scaled) > maxBytes) {
    throw new Error("Could not export this image under 2 MB.");
  }

  const polished = await atSize(scaled.width, scaled.height);
  if (readByteLength(polished) <= maxBytes) return polished;
  return scaled;
}

export function normalizeExportOptions(options = {}) {
  const format = options.format ?? "png";
  if (!["png", "jpeg", "webp"].includes(format)) {
    throw new Error("Choose PNG, JPEG, or WebP as the export format.");
  }
  const quality = options.quality ?? 0.9;
  if (
    typeof quality !== "number" ||
    !Number.isFinite(quality) ||
    quality < 0 ||
    quality > 1
  ) {
    throw new Error("Export quality must be a number between 0 and 1.");
  }
  if (
    options.includeOriginals != null &&
    typeof options.includeOriginals !== "boolean"
  ) {
    throw new Error("Include originals must be true or false.");
  }
  let maxBytes = MAX_EXPORT_BYTES;
  if (options.maxBytes === null || options.maxBytes === false) {
    maxBytes = null;
  } else if (
    options.maxBytes != null &&
    options.maxBytes !== true &&
    options.maxBytes !== MAX_EXPORT_BYTES
  ) {
    throw new Error("Size limit must be the 2 MB preset or original.");
  }
  return {
    format,
    quality,
    includeOriginals: options.includeOriginals ?? true,
    maxBytes,
  };
}

export function validateResolutions(resolutions) {
  if (!Array.isArray(resolutions) || !resolutions.length) {
    throw new Error("Choose at least one output size.");
  }
  return resolutions.map((resolution) => {
    if (
      ![resolution?.width, resolution?.height].every(
        (value) => typeof value === "number" || typeof value === "string",
      )
    ) {
      throw new Error(
        "Output width and height must be positive whole numbers.",
      );
    }
    const width = Number(resolution?.width);
    const height = Number(resolution?.height);
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1
    ) {
      throw new Error(
        "Output width and height must be positive whole numbers.",
      );
    }
    if (width > MAX_OUTPUT_SIDE || height > MAX_OUTPUT_SIDE) {
      throw new Error(
        `Output dimensions cannot exceed ${MAX_OUTPUT_SIDE} pixels per side.`,
      );
    }
    if (width * height > MAX_OUTPUT_PIXELS) {
      throw new Error("Each output must be 32 megapixels or smaller.");
    }
    return { ...resolution, width, height };
  });
}

export function orientedDimensions(metadata) {
  const swap = [5, 6, 7, 8].includes(metadata.orientation);
  return {
    width: (swap ? metadata.height : metadata.width) || 0,
    height: (swap ? metadata.width : metadata.height) || 0,
  };
}

export function normalizeCrop(crop, srcW, srcH, targetW, targetH) {
  if (
    !Number.isInteger(srcW) ||
    !Number.isInteger(srcH) ||
    srcW < 1 ||
    srcH < 1
  ) {
    throw new Error("Could not read image dimensions.");
  }
  if (
    !Number.isFinite(targetW) ||
    !Number.isFinite(targetH) ||
    targetW <= 0 ||
    targetH <= 0
  ) {
    throw new Error("Output dimensions must be positive numbers.");
  }
  const aspect = targetW / targetH;
  const width = Math.min(srcW, srcH * aspect);
  const height = Math.min(srcH, srcW / aspect);
  const fallback = {
    left: (srcW - width) / 2,
    top: (srcH - height) / 2,
    width,
    height,
  };
  const valid =
    crop &&
    [crop.left, crop.top, crop.width, crop.height].every(Number.isFinite) &&
    crop.width > 0 &&
    crop.height > 0;
  const source = valid ? crop : fallback;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const left = clamp(Math.round(source.left), 0, srcW - 1);
  const top = clamp(Math.round(source.top), 0, srcH - 1);
  const right = clamp(Math.round(source.left + source.width), left + 1, srcW);
  const bottom = clamp(Math.round(source.top + source.height), top + 1, srcH);
  return { left, top, width: right - left, height: bottom - top };
}

export function safeFileName(name = "image") {
  const leaf = String(name).split(/[\\/]/).pop() || "image";
  let clean = leaf
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "-")
    .replace(/[. ]+$/, "");
  if (!clean || clean === "." || clean === "..") clean = "image";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean))
    clean = `image-${clean}`;
  return clean;
}

export function fileBase(name) {
  const base = safeFileName(name);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

export function uniqueName(used, name) {
  const safe = safeFileName(name);
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  let candidate = safe;
  let suffix = 2;
  while (used.has(candidate.toLowerCase()))
    candidate = `${stem}-${suffix++}${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

export function outputFileName(name, width, height, format) {
  return `${fileBase(name)}_${width}x${height}.${format === "jpeg" ? "jpg" : format}`;
}
