import { installWebApi } from "./web-api.js";

installWebApi();

const imageListEl = document.getElementById("image-list");
const imageEmptyEl = document.getElementById("image-empty");
const dropZoneEl = document.getElementById("drop-zone");
const addImagesBtn = document.getElementById("add-images");
const resForm = document.getElementById("res-form");
const resWidthEl = document.getElementById("res-width");
const resHeightEl = document.getElementById("res-height");
const resChipsEl = document.getElementById("res-chips");
const resEmptyEl = document.getElementById("res-empty");
const outputPathEl = document.getElementById("output-path");
const outputHintEl = document.getElementById("output-hint");
const outputActionsEl = document.getElementById("output-actions");
const chooseOutputBtn = document.getElementById("choose-output");
const revealOutputBtn = document.getElementById("reveal-output");
const rescaleBtn = document.getElementById("rescale");
const resultsEl = document.getElementById("results");
const resultsEmptyEl = document.getElementById("results-empty");
const progressEl = document.getElementById("progress");
const progressBarEl = document.getElementById("progress-bar");
const progressLabelEl = document.getElementById("progress-label");
const resetCropBtn = document.getElementById("reset-crop");
const previewResTabsEl = document.getElementById("preview-res-tabs");
const previewEmptyEl = document.getElementById("preview-empty");
const cropViewportEl = document.getElementById("crop-viewport");
const cropImageEl = document.getElementById("crop-image");
const cropFrameEl = document.getElementById("crop-frame");
const outputPreviewFrameEl = document.getElementById("output-preview-frame");
const outputPreviewImageEl = document.getElementById("output-preview-image");
const outputPreviewLabelEl = document.getElementById("output-preview-label");

const previewCache = new Map();
const isWeb = Boolean(window.api?.isWeb);

const DEFAULT_RESOLUTIONS = [
  { width: 680, height: 1000 },
  { width: 1020, height: 1000 },
  { width: 1119, height: 1527 },
  { width: 1119, height: 648 },
];

const state = {
  images: [],
  resolutions: DEFAULT_RESOLUTIONS.map((item) => ({ ...item })),
  outputDir: "",
  lastRunDir: "",
  busy: false,
  selectedImageId: "",
  selectedWidth: DEFAULT_RESOLUTIONS[0].width,
  selectedHeight: DEFAULT_RESOLUTIONS[0].height,
  crops: {},
};

const drag = {
  active: false,
  x: 0,
  y: 0,
};

const cropLayout = {
  imgW: 1,
  imgH: 1,
};

function uniqueKey(image) {
  return image.id || image.path;
}

function cropKey(width, height) {
  return `${width}x${height}`;
}

function usableImages() {
  return state.images.filter((image) => !image.error && image.width && image.height);
}

function selectedImage() {
  return state.images.find((image) => uniqueKey(image) === state.selectedImageId) || null;
}

function selectedResolution() {
  return (
    state.resolutions.find(
      (item) => item.width === state.selectedWidth && item.height === state.selectedHeight
    ) || null
  );
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

function clampCrop(crop, srcW, srcH, aspect) {
  const cover = coverCrop(srcW, srcH, aspect);
  const minSide = Math.min(32, cover.width, cover.height);
  let width = Math.min(cover.width, Math.max(minSide, crop.width));
  let height = width / aspect;

  if (height > cover.height) {
    height = cover.height;
    width = height * aspect;
  }

  const centerX = crop.left + crop.width / 2;
  const centerY = crop.top + crop.height / 2;
  let left = centerX - width / 2;
  let top = centerY - height / 2;
  left = Math.min(Math.max(0, left), srcW - width);
  top = Math.min(Math.max(0, top), srcH - height);

  return { left, top, width, height };
}

function getCrop(image, resolution) {
  const stored = state.crops[uniqueKey(image)]?.[cropKey(resolution.width, resolution.height)];
  if (stored) {
    return clampCrop(
      stored,
      image.width,
      image.height,
      resolution.width / resolution.height
    );
  }

  return coverCrop(image.width, image.height, resolution.width / resolution.height);
}

function setCrop(image, resolution, crop) {
  const key = cropKey(resolution.width, resolution.height);
  const imageKey = uniqueKey(image);
  if (!state.crops[imageKey]) {
    state.crops[imageKey] = {};
  }
  state.crops[imageKey][key] = clampCrop(
    crop,
    image.width,
    image.height,
    resolution.width / resolution.height
  );
}

function ensureSelection() {
  const images = usableImages();
  if (!images.some((image) => uniqueKey(image) === state.selectedImageId)) {
    state.selectedImageId = images[0] ? uniqueKey(images[0]) : "";
  }

  const stillSelected = state.resolutions.some(
    (item) => item.width === state.selectedWidth && item.height === state.selectedHeight
  );
  if (!stillSelected) {
    state.selectedWidth = state.resolutions[0]?.width || 0;
    state.selectedHeight = state.resolutions[0]?.height || 0;
  }
}

function resolvedPreview(image) {
  const cached = image ? previewCache.get(uniqueKey(image)) : null;
  if (!cached || typeof cached.then === "function") {
    return null;
  }
  return cached;
}

async function loadPreview(image) {
  if (!window.api?.getImagePreview || image.error) {
    return null;
  }

  const imageKey = uniqueKey(image);
  const cached = previewCache.get(imageKey);
  if (cached && typeof cached.then !== "function") {
    return cached;
  }
  if (cached) {
    return cached;
  }

  const pending = window.api.getImagePreview(imageKey).then((preview) => {
    image.previewUrl = preview.dataUrl;
    previewCache.set(imageKey, preview);
    return preview;
  });
  previewCache.set(imageKey, pending);

  try {
    return await pending;
  } catch (error) {
    previewCache.delete(imageKey);
    throw error;
  }
}

function addImages(nextImages) {
  const seen = new Set(state.images.map(uniqueKey));

  for (const image of nextImages) {
    const key = image ? uniqueKey(image) : "";
    if (!key || seen.has(key)) {
      continue;
    }
    if (!image.id) {
      image.id = image.path;
    }
    seen.add(key);
    state.images.push(image);
  }

  ensureSelection();
  renderImages();
  renderResolutions();
  updateActions();
  refreshPreview();

  for (const image of usableImages()) {
    loadPreview(image)
      .then(() => renderImages())
      .catch(() => {});
  }
}

function removeImage(imageKey) {
  state.images = state.images.filter((image) => uniqueKey(image) !== imageKey);
  delete state.crops[imageKey];
  previewCache.delete(imageKey);
  window.api?.releaseImage?.(imageKey);
  ensureSelection();
  renderImages();
  updateActions();
  refreshPreview();
}

function addResolution(width, height) {
  const exists = state.resolutions.some(
    (item) => item.width === width && item.height === height
  );
  if (!exists) {
    state.resolutions.unshift({ width, height });
  } else {
    state.resolutions = [
      { width, height },
      ...state.resolutions.filter(
        (item) => !(item.width === width && item.height === height)
      ),
    ];
  }
  state.selectedWidth = width;
  state.selectedHeight = height;
  renderResolutions();
  updateActions();
  refreshPreview();
}

function removeResolution(width, height) {
  state.resolutions = state.resolutions.filter(
    (item) => !(item.width === width && item.height === height)
  );
  for (const imageKey of Object.keys(state.crops)) {
    delete state.crops[imageKey][cropKey(width, height)];
  }
  ensureSelection();
  renderResolutions();
  updateActions();
  refreshPreview();
}

function selectImage(imageKey) {
  const image = state.images.find((item) => uniqueKey(item) === imageKey);
  if (!image || image.error) {
    return;
  }
  state.selectedImageId = imageKey;
  renderImages();
  refreshPreview();
}

function selectResolution(width, height) {
  state.selectedWidth = width;
  state.selectedHeight = height;
  renderResolutions();
  refreshPreview();
}

function renderImages() {
  imageListEl.innerHTML = "";
  const hasImages = state.images.length > 0;
  imageListEl.hidden = !hasImages;
  imageEmptyEl.hidden = hasImages;

  for (const image of state.images) {
    const item = document.createElement("li");
    const main = document.createElement("div");
    const meta = document.createElement("div");
    const name = document.createElement("strong");
    const size = document.createElement("span");
    const remove = document.createElement("button");
    const imageKey = uniqueKey(image);

    if (imageKey === state.selectedImageId) {
      item.classList.add("selected");
    }

    name.textContent = image.name;
    size.textContent = image.error
      ? image.error
      : `${image.width} × ${image.height}`;
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      removeImage(imageKey);
    });

    if (image.previewUrl) {
      const thumb = document.createElement("img");
      thumb.className = "thumb";
      thumb.alt = "";
      thumb.src = image.previewUrl;
      main.append(thumb);
    }

    meta.append(name, size);
    main.className = "file-main";
    main.append(meta);
    item.append(main, remove);
    item.addEventListener("click", () => selectImage(imageKey));
    imageListEl.append(item);
  }
}

function renderChip(resolution, onSelect) {
  const chip = document.createElement("span");
  chip.className = "chip";
  if (
    resolution.width === state.selectedWidth &&
    resolution.height === state.selectedHeight
  ) {
    chip.classList.add("selected");
  }
  chip.append(`${resolution.width} × ${resolution.height}`);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove";
  remove.textContent = "×";
  remove.setAttribute(
    "aria-label",
    `Remove ${resolution.width} by ${resolution.height}`
  );
  remove.addEventListener("click", (event) => {
    event.stopPropagation();
    removeResolution(resolution.width, resolution.height);
  });

  chip.append(remove);
  chip.addEventListener("click", () => onSelect(resolution.width, resolution.height));
  return chip;
}

function renderResolutions() {
  resChipsEl.innerHTML = "";
  previewResTabsEl.innerHTML = "";
  const hasResolutions = state.resolutions.length > 0;
  resEmptyEl.hidden = hasResolutions;

  for (const resolution of state.resolutions) {
    resChipsEl.append(renderChip(resolution, selectResolution));
    previewResTabsEl.append(renderChip(resolution, selectResolution));
  }
}

function resultLabel(result) {
  if (result.outputPath) {
    return result.outputPath.split("/").pop();
  }
  if (result.source) {
    return String(result.source).split("/").pop();
  }
  return "Failed";
}

function renderResults(results) {
  resultsEl.innerHTML = "";
  const hasResults = results.length > 0;
  resultsEmptyEl.hidden = hasResults;

  for (const result of results) {
    const item = document.createElement("li");
    const meta = document.createElement("div");
    const name = document.createElement("strong");
    const size = document.createElement("span");

    if (result.error) {
      item.classList.add("fail");
      name.textContent = resultLabel(result);
      size.textContent = result.error;
      meta.append(name, size);
      item.append(meta);
      resultsEl.append(item);
      continue;
    }

    name.textContent = resultLabel(result);
    size.innerHTML = `<span class="ok-size">${result.width} × ${result.height}</span> · PNG crop`;
    meta.append(name, size);

    if (!isWeb && result.outputPath && window.api?.revealItem) {
      const reveal = document.createElement("button");
      reveal.type = "button";
      reveal.className = "ghost";
      reveal.textContent = "Reveal in Finder";
      reveal.addEventListener("click", () => window.api.revealItem(result.outputPath));
      item.append(meta, reveal);
    } else {
      item.append(meta);
    }

    resultsEl.append(item);
  }
}

function updateActions() {
  const canRun =
    !state.busy && usableImages().length > 0 && state.resolutions.length > 0;
  rescaleBtn.disabled = !canRun;
  resetCropBtn.disabled = !canRun || !selectedImage() || !selectedResolution();
}

function setBusy(busy) {
  state.busy = busy;
  updateActions();
  addImagesBtn.disabled = busy;
  resForm.querySelector("button").disabled = busy;
  cropViewportEl.style.pointerEvents = busy ? "none" : "auto";
}

function setProgress(current, total, label) {
  const show = total > 0;
  progressEl.hidden = !show;
  progressLabelEl.textContent = label || "";
  progressBarEl.style.width = show ? `${Math.round((current / total) * 100)}%` : "0%";
}

function layoutCrop() {
  const image = selectedImage();
  const resolution = selectedResolution();
  const preview = resolvedPreview(image);

  if (!image || image.error || !resolution || !preview) {
    return;
  }

  const stage = cropViewportEl.getBoundingClientRect();
  if (!stage.width || !stage.height) {
    return;
  }

  const pad = 28;
  const maxW = Math.max(80, stage.width - pad * 2);
  const maxH = Math.max(80, stage.height - pad * 2);
  const contain = Math.min(maxW / preview.previewWidth, maxH / preview.previewHeight);
  const imgW = preview.previewWidth * contain;
  const imgH = preview.previewHeight * contain;
  const imgX = (stage.width - imgW) / 2;
  const imgY = (stage.height - imgH) / 2;
  cropLayout.imgW = imgW;
  cropLayout.imgH = imgH;

  cropImageEl.style.width = `${imgW}px`;
  cropImageEl.style.height = `${imgH}px`;
  cropImageEl.style.left = `${imgX}px`;
  cropImageEl.style.top = `${imgY}px`;

  const crop = getCrop(image, resolution);
  const scaleX = imgW / image.width;
  const scaleY = imgH / image.height;
  cropFrameEl.style.left = `${imgX + crop.left * scaleX}px`;
  cropFrameEl.style.top = `${imgY + crop.top * scaleY}px`;
  cropFrameEl.style.width = `${crop.width * scaleX}px`;
  cropFrameEl.style.height = `${crop.height * scaleY}px`;

  const aspect = resolution.width / resolution.height;
  const previewFrameW = outputPreviewFrameEl.clientWidth || 140;
  const previewFrameH = previewFrameW / aspect;
  const previewScaleX = preview.previewWidth / image.width;
  const previewScaleY = preview.previewHeight / image.height;
  outputPreviewFrameEl.style.aspectRatio = `${resolution.width} / ${resolution.height}`;
  outputPreviewImageEl.src = preview.dataUrl;
  outputPreviewImageEl.style.width = `${preview.previewWidth * (previewFrameW / (crop.width * previewScaleX))}px`;
  outputPreviewImageEl.style.height = `${preview.previewHeight * (previewFrameH / (crop.height * previewScaleY))}px`;
  outputPreviewImageEl.style.left = `${-crop.left * previewScaleX * (previewFrameW / (crop.width * previewScaleX))}px`;
  outputPreviewImageEl.style.top = `${-crop.top * previewScaleY * (previewFrameH / (crop.height * previewScaleY))}px`;
  outputPreviewLabelEl.textContent = `${resolution.width} × ${resolution.height} PNG`;
}

async function refreshPreview() {
  const image = selectedImage();
  const resolution = selectedResolution();
  const ready = Boolean(image && !image.error && resolution);

  previewEmptyEl.hidden = ready;
  cropViewportEl.hidden = !ready;
  updateActions();

  if (!ready) {
    outputPreviewImageEl.removeAttribute("src");
    outputPreviewLabelEl.textContent = "No crop yet";
    return;
  }

  try {
    const preview = await loadPreview(image);
    cropImageEl.src = preview.dataUrl;
    outputPreviewImageEl.src = preview.dataUrl;
    layoutCrop();
  } catch (error) {
    previewEmptyEl.hidden = false;
    cropViewportEl.hidden = true;
    previewEmptyEl.textContent = error.message || "Could not load preview";
  }
}

function panCrop(dx, dy) {
  const image = selectedImage();
  const resolution = selectedResolution();
  if (!image || !resolution) {
    return;
  }

  const crop = getCrop(image, resolution);
  const sx = dx * (image.width / cropLayout.imgW);
  const sy = dy * (image.height / cropLayout.imgH);
  setCrop(image, resolution, {
    ...crop,
    left: crop.left + sx,
    top: crop.top + sy,
  });
  layoutCrop();
}

function zoomCrop(factor) {
  const image = selectedImage();
  const resolution = selectedResolution();
  if (!image || !resolution) {
    return;
  }

  const crop = getCrop(image, resolution);
  setCrop(image, resolution, {
    left: crop.left,
    top: crop.top,
    width: crop.width * factor,
    height: crop.height * factor,
  });
  layoutCrop();
}

async function addImagesFromPaths(paths) {
  const images = await window.api.inspectPaths(paths);
  addImages(images);
}

async function handleDroppedFiles(fileList) {
  const files = [...fileList];
  if (!files.length) {
    return;
  }

  if (window.api.inspectFiles) {
    addImages(await window.api.inspectFiles(files));
    return;
  }

  const paths = files.map((file) => window.api.getPathForFile(file)).filter(Boolean);
  if (!paths.length) {
    return;
  }

  await addImagesFromPaths(paths);
}

addImagesBtn.addEventListener("click", async () => {
  const images = await window.api.pickImages();
  addImages(images);
});

["dragenter", "dragover"].forEach((eventName) => {
  dropZoneEl.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZoneEl.classList.add("active");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZoneEl.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZoneEl.classList.remove("active");
  });
});

dropZoneEl.addEventListener("drop", (event) => {
  handleDroppedFiles(event.dataTransfer.files);
});

resForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const width = Number.parseInt(resWidthEl.value, 10);
  const height = Number.parseInt(resHeightEl.value, 10);

  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return;
  }

  addResolution(width, height);
  resWidthEl.value = "";
  resHeightEl.value = "";
  resWidthEl.focus();
});

chooseOutputBtn.addEventListener("click", async () => {
  if (isWeb) {
    return;
  }
  const folder = await window.api.pickOutputFolder();
  if (folder) {
    state.outputDir = folder;
    outputPathEl.textContent = folder;
  }
});

revealOutputBtn.addEventListener("click", () => {
  if (isWeb) {
    return;
  }
  window.api.revealFolder(state.lastRunDir || state.outputDir);
});

resetCropBtn.addEventListener("click", () => {
  const image = selectedImage();
  const resolution = selectedResolution();
  if (!image || !resolution) {
    return;
  }

  setCrop(
    image,
    resolution,
    coverCrop(image.width, image.height, resolution.width / resolution.height)
  );
  layoutCrop();
});

cropViewportEl.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || state.busy) {
    return;
  }
  drag.active = true;
  drag.x = event.clientX;
  drag.y = event.clientY;
  cropViewportEl.classList.add("dragging");
  cropViewportEl.setPointerCapture(event.pointerId);
});

cropViewportEl.addEventListener("pointermove", (event) => {
  if (!drag.active) {
    return;
  }
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  drag.x = event.clientX;
  drag.y = event.clientY;
  panCrop(dx, dy);
});

function endDrag() {
  drag.active = false;
  cropViewportEl.classList.remove("dragging");
}

cropViewportEl.addEventListener("pointerup", endDrag);
cropViewportEl.addEventListener("pointercancel", endDrag);

cropViewportEl.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    if (state.busy) {
      return;
    }
    zoomCrop(event.deltaY > 0 ? 1.08 : 1 / 1.08);
  },
  { passive: false }
);

rescaleBtn.addEventListener("click", async () => {
  if (state.busy) {
    return;
  }

  setBusy(true);
  setProgress(0, 1, "Starting…");
  resultsEmptyEl.hidden = true;

  try {
    const { results, outputDir } = await window.api.resizeImages({
      images: usableImages(),
      resolutions: state.resolutions,
      outputDir: state.outputDir,
      crops: state.crops,
    });
    if (outputDir) {
      state.lastRunDir = outputDir;
    }
    renderResults(results);
  } catch (error) {
    renderResults([
      {
        error: error.message || "Could not rescale images",
      },
    ]);
  } finally {
    setBusy(false);
  }
});

window.api?.onResizeProgress?.((data) => {
  if (data.done) {
    setProgress(data.total, data.total, "Done");
    return;
  }

  setProgress(
    data.current,
    data.total,
    `${data.current} / ${data.total}  ${data.file} → ${data.preset}`
  );
});

const cropObserver = new ResizeObserver(() => {
  layoutCrop();
});
cropObserver.observe(cropViewportEl);

async function init() {
  document.body.classList.toggle("is-web", isWeb);

  if (isWeb) {
    outputPathEl.textContent = "Rescale downloads a ZIP with originals and PNGs.";
    if (outputHintEl) {
      outputHintEl.textContent = "Each run is one dated ZIP: originals/ plus every size.";
    }
    if (outputActionsEl) {
      outputActionsEl.hidden = true;
    }
  } else if (window.api?.getDefaultOutput) {
    state.outputDir = await window.api.getDefaultOutput();
    outputPathEl.textContent = state.outputDir;
  }

  renderImages();
  renderResolutions();
  updateActions();
}

init();

if (import.meta.env.DEV) {
  window.__imageRescaler = {
    addImagesFromPaths,
    addResolution,
    getState: () => ({
      images: state.images,
      resolutions: state.resolutions,
      crops: state.crops,
      selectedImageId: state.selectedImageId,
      selectedWidth: state.selectedWidth,
      selectedHeight: state.selectedHeight,
      lastRunDir: state.lastRunDir,
    }),
  };
}
