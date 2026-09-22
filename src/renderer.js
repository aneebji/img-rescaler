import { installWebApi } from "./web-api.js";
import { icon, hydrateIcons } from "./icons.js";
import { MAX_EXPORT_BYTES, validateResolutions } from "./export-utils.mjs";

installWebApi();
hydrateIcons();
const $ = (id) => document.getElementById(id);
const isWeb = Boolean(window.api?.isWeb);
const PRESETS = [
  { name: "Square post", width: 1080, height: 1080, category: "Social" },
  { name: "Story / Reel", width: 1080, height: 1920, category: "Social" },
  { name: "Landscape", width: 1920, height: 1080, category: "Web" },
  { name: "Portrait post", width: 1080, height: 1350, category: "Social" },
  { name: "Video thumbnail", width: 1280, height: 720, category: "Social" },
  { name: "Social link card", width: 1200, height: 630, category: "Social" },
  { name: "Product square", width: 2000, height: 2000, category: "Commerce" },
  { name: "Product portrait", width: 1600, height: 2000, category: "Commerce" },
  { name: "Store banner", width: 2400, height: 800, category: "Commerce" },
  { name: "Website hero", width: 2400, height: 1350, category: "Web" },
  { name: "Blog cover", width: 1600, height: 900, category: "Web" },
  { name: "Profile image", width: 512, height: 512, category: "Web" },
  { name: "Original portrait", width: 680, height: 1000, category: "Original" },
  {
    name: "Original near-square",
    width: 1020,
    height: 1000,
    category: "Original",
  },
  { name: "Original tall", width: 1119, height: 1527, category: "Original" },
  { name: "Original wide", width: 1119, height: 648, category: "Original" },
];
const defaults = PRESETS.slice(0, 3).map((item) => ({ ...item }));
const SETTINGS_KEY = "image-rescaler:settings:v2";
let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {};
} catch {
  /* Storage can be unavailable. */
}
let initialSizes = defaults;
try {
  if (Array.isArray(saved.resolutions) && saved.resolutions.length <= 30)
    initialSizes = saved.resolutions.length
      ? validateResolutions(saved.resolutions)
      : [];
} catch {
  /* Restore valid defaults. */
}
const state = {
  images: [],
  resolutions: initialSizes,
  crops: {},
  selectedImageId: "",
  selectedSize: initialSizes[0] ? sizeKey(initialSizes[0]) : "",
  format: ["png", "jpeg", "webp"].includes(saved.format) ? saved.format : "png",
  quality: Number.isFinite(saved.quality)
    ? Math.max(0.1, Math.min(1, saved.quality))
    : 0.9,
  includeOriginals: saved.includeOriginals !== false,
  limitFileSize: saved.limitFileSize !== false,
  theme: saved.theme === "dark" ? "dark" : "light",
  showGrid: true,
  previewReady: false,
  busy: false,
  importing: false,
  results: [],
  outputDir: "",
  lastRunDir: "",
};
const previews = new Map();
const cropLayout = { width: 1, height: 1 };
let previewRevision = 0;
let toastTimer;
let drag = null;
let presetCategory = "All";

function sizeKey(size) {
  return `${size.width}x${size.height}`;
}
function imageKey(image) {
  return image.id || image.path;
}
function usableImages() {
  return state.images.filter(
    (image) => !image.error && image.width && image.height,
  );
}
function selectedImage() {
  return state.images.find(
    (image) => imageKey(image) === state.selectedImageId,
  );
}
function selectedResolution() {
  return state.resolutions.find((size) => sizeKey(size) === state.selectedSize);
}
function formatBytes(bytes) {
  if (!bytes) return "";
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function formatName() {
  return state.format === "webp" ? "WebP" : state.format.toUpperCase();
}
function sizeName(size) {
  return (
    size.name ||
    PRESETS.find((p) => sizeKey(p) === sizeKey(size))?.name ||
    "Custom size"
  );
}
function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        resolutions: state.resolutions,
        format: state.format,
        quality: state.quality,
        includeOriginals: state.includeOriginals,
        limitFileSize: state.limitFileSize,
        theme: state.theme,
      }),
    );
  } catch {
    /* Editing still works without storage. */
  }
}
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $("toast").replaceChildren();
  const mark = document.createElement("span");
  mark.innerHTML = icon(error ? "help" : "check");
  const text = document.createElement("span");
  text.textContent = message;
  $("toast").append(mark, text);
  $("toast").hidden = false;
  toastTimer = setTimeout(
    () => {
      $("toast").hidden = true;
    },
    error ? 6500 : 3500,
  );
}
function coverCrop(width, height, aspect) {
  const w = Math.min(width, height * aspect);
  const h = w / aspect;
  return { left: (width - w) / 2, top: (height - h) / 2, width: w, height: h };
}
function clampCrop(crop, image, resolution) {
  const aspect = resolution.width / resolution.height;
  const cover = coverCrop(image.width, image.height, aspect);
  const width = Math.min(cover.width, Math.max(cover.width / 4, crop.width));
  const height = width / aspect;
  return {
    width,
    height,
    left: Math.max(
      0,
      Math.min(image.width - width, crop.left + (crop.width - width) / 2),
    ),
    top: Math.max(
      0,
      Math.min(image.height - height, crop.top + (crop.height - height) / 2),
    ),
  };
}
function getCrop(image, resolution) {
  return clampCrop(
    state.crops[imageKey(image)]?.[sizeKey(resolution)] ||
      coverCrop(
        image.width,
        image.height,
        resolution.width / resolution.height,
      ),
    image,
    resolution,
  );
}
function setCrop(image, resolution, crop) {
  (state.crops[imageKey(image)] ||= {})[sizeKey(resolution)] = clampCrop(
    crop,
    image,
    resolution,
  );
}
function ensureSelection() {
  if (
    !usableImages().some((image) => imageKey(image) === state.selectedImageId)
  )
    state.selectedImageId = usableImages()[0]
      ? imageKey(usableImages()[0])
      : "";
  if (!selectedResolution())
    state.selectedSize = state.resolutions[0]
      ? sizeKey(state.resolutions[0])
      : "";
}
async function loadPreview(image) {
  const key = imageKey(image);
  if (previews.has(key)) return previews.get(key);
  const pending = window.api
    .getImagePreview(key)
    .then((preview) => {
      if (state.images.includes(image)) {
        previews.set(key, preview);
        image.previewUrl = preview.dataUrl;
      }
      return preview;
    })
    .catch((error) => {
      previews.delete(key);
      throw error;
    });
  previews.set(key, pending);
  return pending;
}
async function addImages(images) {
  const seen = new Set(state.images.map(imageKey));
  for (const image of images)
    if (image && imageKey(image) && !seen.has(imageKey(image))) {
      state.images.push(image);
      seen.add(imageKey(image));
    }
  ensureSelection();
  renderImages();
  updateActions();
  refreshPreview();
  const failed = images.filter((image) => image.error).length;
  if (failed)
    toast(
      `${failed} ${failed === 1 ? "file could" : "files could"} not be opened. Try a PNG, JPEG, or WebP image.`,
      true,
    );
  // Decode previews sequentially to avoid memory spikes on large imports.
  for (const image of usableImages()) {
    if (!state.images.includes(image)) continue;
    try {
      await loadPreview(image);
      renderImages();
    } catch {
      /* Main preview reports decode failures. */
    }
  }
}
async function importImages(loader) {
  if (state.busy || state.importing) return;
  state.importing = true;
  updateActions();
  try {
    const images = await loader();
    if (images?.length) await addImages(images);
  } catch (error) {
    toast(error.message || "Could not open these images.", true);
  } finally {
    state.importing = false;
    updateActions();
  }
}
function pickImages() {
  return importImages(() => window.api.pickImages());
}
function removeImage(key) {
  if (state.busy || state.importing) return;
  state.images = state.images.filter((image) => imageKey(image) !== key);
  delete state.crops[key];
  previews.delete(key);
  window.api.releaseImage?.(key);
  ensureSelection();
  renderImages();
  updateActions();
  refreshPreview();
}
function preserveFocus(container) {
  const key = container.contains(document.activeElement)
    ? document.activeElement.dataset.focusKey
    : "";
  return () => {
    if (key)
      (
        container.querySelector(`[data-focus-key="${CSS.escape(key)}"]`) ||
        container.querySelector("button:not(:disabled)")
      )?.focus({ preventScroll: true });
  };
}
function renderImages() {
  const restoreFocus = preserveFocus($("image-list"));
  $("image-list").replaceChildren();
  $("image-list").hidden = !state.images.length;
  $("image-count").textContent = state.images.length;
  $("clear-images").hidden = !state.images.length;
  $("library-hint").hidden = Boolean(state.images.length);
  for (const image of state.images) {
    const item = document.createElement("li");
    const key = imageKey(image);
    item.classList.toggle("selected", key === state.selectedImageId);
    const select = document.createElement("button");
    select.type = "button";
    select.className = "file-select";
    select.dataset.focusKey = `select-${key}`;
    select.setAttribute("aria-label", `Select ${image.name}`);
    select.setAttribute("aria-pressed", String(key === state.selectedImageId));
    select.disabled = state.busy || Boolean(image.error);
    if (image.previewUrl) {
      const thumb = document.createElement("img");
      thumb.className = "thumb";
      thumb.alt = "";
      thumb.src = image.previewUrl;
      select.append(thumb);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "file-error";
      placeholder.textContent = image.error
        ? "Unsupported image"
        : "Loading preview…";
      select.append(placeholder);
    }
    const meta = document.createElement("span");
    meta.className = "file-meta";
    const name = document.createElement("strong");
    name.textContent = image.name;
    const details = document.createElement("small");
    details.textContent = image.error
      ? "Try another format"
      : `${image.width} × ${image.height}${image.size ? ` · ${formatBytes(image.size)}` : ""}`;
    meta.append(name, details);
    select.append(meta);
    select.addEventListener("click", () => {
      state.selectedImageId = key;
      renderImages();
      refreshPreview();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-image";
    remove.innerHTML = icon("close");
    remove.dataset.focusKey = `remove-${key}`;
    remove.setAttribute("aria-label", `Remove ${image.name}`);
    remove.disabled = state.busy || state.importing;
    remove.addEventListener("click", () => removeImage(key));
    item.append(select, remove);
    $("image-list").append(item);
  }
  restoreFocus();
}
function shape(size) {
  const wrap = document.createElement("span");
  wrap.className = "size-shape-wrap";
  const box = document.createElement("span");
  box.className = "size-shape";
  box.style.setProperty("--ratio", size.width / size.height);
  if (size.height > size.width) {
    box.style.height = "23px";
    box.style.width = `${(23 * size.width) / size.height}px`;
  }
  wrap.append(box);
  return wrap;
}
function addResolution(size) {
  if (state.busy) return false;
  try {
    validateResolutions([size]);
  } catch (error) {
    toast(error.message, true);
    return false;
  }
  const key = sizeKey(size);
  if (!state.resolutions.some((r) => sizeKey(r) === key)) {
    if (state.resolutions.length >= 30) {
      toast("Use up to 30 output sizes in one batch.", true);
      return false;
    }
    state.resolutions.push({ ...size });
  }
  state.selectedSize = key;
  saveSettings();
  renderResolutions();
  renderPresets();
  updateActions();
  refreshPreview();
  return true;
}
function removeResolution(key) {
  if (state.busy) return;
  state.resolutions = state.resolutions.filter((size) => sizeKey(size) !== key);
  for (const crops of Object.values(state.crops)) delete crops[key];
  ensureSelection();
  saveSettings();
  renderResolutions();
  renderPresets();
  updateActions();
  refreshPreview();
}
function selectResolution(key) {
  if (state.busy) return;
  state.selectedSize = key;
  renderResolutions();
  refreshPreview();
}
function renderResolutions() {
  const restoreSizeFocus = preserveFocus($("res-chips"));
  const restoreTabFocus = preserveFocus($("preview-res-tabs"));
  $("res-chips").replaceChildren();
  $("preview-res-tabs").replaceChildren();
  $("res-empty").hidden = Boolean(state.resolutions.length);
  for (const size of state.resolutions) {
    const key = sizeKey(size);
    const selected = key === state.selectedSize;
    const row = document.createElement("div");
    row.className = `size-row${selected ? " selected" : ""}`;
    const select = document.createElement("button");
    select.type = "button";
    select.className = "size-select";
    select.dataset.focusKey = `select-${key}`;
    select.setAttribute("aria-pressed", String(selected));
    select.setAttribute(
      "aria-label",
      `Preview ${size.width} by ${size.height}`,
    );
    select.disabled = state.busy;
    const info = document.createElement("span");
    info.className = "size-info";
    const name = document.createElement("strong");
    name.textContent = sizeName(size);
    const dimensions = document.createElement("small");
    dimensions.textContent = `${size.width.toLocaleString()} × ${size.height.toLocaleString()} px`;
    info.append(name, dimensions);
    select.append(shape(size), info);
    select.addEventListener("click", () => selectResolution(key));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "size-remove";
    remove.innerHTML = icon("close");
    remove.dataset.focusKey = `remove-${key}`;
    remove.setAttribute("aria-label", `Remove ${size.width} by ${size.height}`);
    remove.disabled = state.busy;
    remove.addEventListener("click", () => removeResolution(key));
    row.append(select, remove);
    $("res-chips").append(row);
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "preview-tab";
    tab.dataset.focusKey = key;
    tab.setAttribute("aria-pressed", String(selected));
    tab.disabled = state.busy;
    const dot = document.createElement("span");
    dot.className = "tab-dot";
    tab.append(dot, `${size.width} × ${size.height}`);
    tab.addEventListener("click", () => selectResolution(key));
    $("preview-res-tabs").append(tab);
  }
  restoreSizeFocus();
  restoreTabFocus();
}
function updateActions() {
  const locked = state.busy || state.importing;
  const ready = Boolean(
    selectedImage() &&
    selectedResolution() &&
    !selectedImage().error &&
    state.previewReady,
  );
  const count = usableImages().length;
  const total = count * state.resolutions.length;
  $("rescale").disabled = locked || !total;
  $("export-equation").textContent =
    `${count} ${count === 1 ? "image" : "images"} × ${state.resolutions.length} ${state.resolutions.length === 1 ? "size" : "sizes"}`;
  $("export-total").textContent = `${total} ${total === 1 ? "file" : "files"}`;
  $("export-label").textContent = state.busy
    ? "Preparing your export…"
    : total
      ? `Export ${total} ${total === 1 ? "image" : "images"}`
      : "Export images";
  for (const id of ["add-images", "empty-upload", "load-demo", "clear-images"])
    $(id).disabled = locked;
  for (const id of ["reset-crop", "zoom-in", "zoom-out", "zoom-range"])
    $(id).disabled = locked || !ready;
  for (const selector of [
    "#res-form input",
    "#res-form button",
    "#format-options button",
    "#quality-range",
    "#include-originals",
    "#size-limit",
    "#choose-output",
    ".size-select",
    ".size-remove",
    ".preview-tab",
    ".preset-option",
  ])
    document.querySelectorAll(selector).forEach((el) => {
      el.disabled = state.busy;
    });
  document.querySelectorAll(".remove-image").forEach((el) => {
    el.disabled = locked;
  });
  document.querySelectorAll(".file-select").forEach((el, i) => {
    el.disabled = state.busy || Boolean(state.images[i]?.error);
  });
  $("workspace").setAttribute("aria-busy", String(locked));
  $("drop-zone").setAttribute("aria-disabled", String(locked));
  $("crop-viewport").style.pointerEvents = locked ? "none" : "";
}
function renderFormat() {
  document
    .querySelectorAll("[data-format]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.format === state.format),
      ),
    );
  $("format-badge").textContent =
    state.format === "png"
      ? "LOSSLESS"
      : state.format === "webp"
        ? "WEB READY"
        : "COMPACT";
  $("format-hint").textContent = {
    png: "Crisp details. Full transparency. Zero compromises.",
    jpeg: "Smaller photos. Easy sharing. A clean white background.",
    webp: "Lightweight images for the web, with transparency.",
  }[state.format];
  $("quality-control").hidden = state.format === "png";
  $("quality-range").value = Math.round(state.quality * 100);
  $("quality-value").value = `${Math.round(state.quality * 100)}%`;
  $("include-originals").checked = state.includeOriginals;
  $("size-limit").checked = state.limitFileSize;
  $("size-limit-hint").textContent = state.limitFileSize
    ? "Preset: each file stays under 2 MB."
    : "Original export, with no file-size cap.";
  layoutCrop();
}
function layoutCrop() {
  const image = selectedImage();
  const resolution = selectedResolution();
  const preview = image && previews.get(imageKey(image));
  if (
    !image ||
    !resolution ||
    !preview ||
    preview.then ||
    $("crop-viewport").hidden
  )
    return;
  const rect = $("crop-viewport").getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const contain = Math.min(
    (rect.width - 56) / preview.previewWidth,
    (rect.height - 60) / preview.previewHeight,
  );
  const w = preview.previewWidth * contain;
  const h = preview.previewHeight * contain;
  const x = (rect.width - w) / 2;
  const y = (rect.height - h) / 2;
  cropLayout.width = w;
  cropLayout.height = h;
  Object.assign($("crop-image").style, {
    width: `${w}px`,
    height: `${h}px`,
    left: `${x}px`,
    top: `${y}px`,
  });
  const crop = getCrop(image, resolution);
  const sx = w / image.width;
  const sy = h / image.height;
  Object.assign($("crop-frame").style, {
    left: `${x + crop.left * sx}px`,
    top: `${y + crop.top * sy}px`,
    width: `${crop.width * sx}px`,
    height: `${crop.height * sy}px`,
  });
  $("frame-label").textContent = `${resolution.width} × ${resolution.height}`;
  const frame = $("output-preview-frame");
  const pw = Math.min(
    140,
    (140 * resolution.width) / resolution.height,
    frame.parentElement.clientWidth - 30,
  );
  frame.style.width = `${pw}px`;
  frame.style.aspectRatio = `${resolution.width} / ${resolution.height}`;
  const factor = pw / crop.width;
  Object.assign($("output-preview-image").style, {
    width: `${image.width * factor}px`,
    height: `${image.height * factor}px`,
    left: `${-crop.left * factor}px`,
    top: `${-crop.top * factor}px`,
  });
  $("output-preview-label").textContent =
    `${resolution.width.toLocaleString()} × ${resolution.height.toLocaleString()} px · ${formatName()}`;
  frame.style.backgroundColor =
    state.format === "jpeg" ? "#fff" : "transparent";
  $("upscale-hint").hidden =
    crop.width >= resolution.width && crop.height >= resolution.height;
  const zoom = Math.round(
    (coverCrop(image.width, image.height, resolution.width / resolution.height)
      .width /
      crop.width) *
      100,
  );
  $("zoom-range").value = zoom;
  $("zoom-value").value = `${zoom}%`;
}
async function refreshPreview() {
  const revision = ++previewRevision;
  const image = selectedImage();
  const resolution = selectedResolution();
  const ready = Boolean(image && resolution && !image.error);
  state.previewReady = false;
  $("preview-error").hidden = true;
  updateActions();
  $("preview-empty").hidden = ready;
  $("crop-viewport").hidden = !ready;
  $("output-preview-card").hidden = !ready;
  $("image-detail").hidden = !ready;
  if (!ready) {
    $("crop-image").removeAttribute("src");
    $("output-preview-image").removeAttribute("src");
    $("zoom-range").value = 100;
    $("zoom-value").value = "100%";
    return;
  }
  try {
    const preview = await loadPreview(image);
    if (revision !== previewRevision) return;
    state.previewReady = true;
    updateActions();
    $("crop-image").src = preview.dataUrl;
    $("output-preview-image").src = preview.dataUrl;
    $("image-detail").textContent =
      `${image.name} · ${image.width} × ${image.height}`;
    $("preview-hint").innerHTML =
      `${icon("crop")}<span>Drag to compose. Each size keeps its crop.</span>`;
    layoutCrop();
  } catch (error) {
    if (revision === previewRevision) {
      toast(error.message || "Preview could not load.", true);
      $("crop-viewport").hidden = true;
      $("output-preview-card").hidden = true;
      $("image-detail").hidden = true;
      $("crop-image").removeAttribute("src");
      $("output-preview-image").removeAttribute("src");
      $("preview-error").hidden = false;
      $("preview-error-message").textContent =
        error.message || "Please try again or add the image again.";
      state.previewReady = false;
      updateActions();
    }
  }
}
function panCrop(dx, dy) {
  const image = selectedImage();
  const resolution = selectedResolution();
  if (
    !image ||
    !resolution ||
    !state.previewReady ||
    state.busy ||
    state.importing
  )
    return;
  const crop = getCrop(image, resolution);
  setCrop(image, resolution, {
    ...crop,
    left: crop.left + (dx * image.width) / cropLayout.width,
    top: crop.top + (dy * image.height) / cropLayout.height,
  });
  layoutCrop();
}
function zoomTo(percent) {
  const image = selectedImage();
  const resolution = selectedResolution();
  if (
    !image ||
    !resolution ||
    !state.previewReady ||
    state.busy ||
    state.importing
  )
    return;
  const crop = getCrop(image, resolution);
  const cover = coverCrop(
    image.width,
    image.height,
    resolution.width / resolution.height,
  );
  const width = cover.width / Math.max(1, Math.min(4, percent / 100));
  const height = (width * resolution.height) / resolution.width;
  setCrop(image, resolution, {
    left: crop.left + (crop.width - width) / 2,
    top: crop.top + (crop.height - height) / 2,
    width,
    height,
  });
  layoutCrop();
}
function resetCrop() {
  const image = selectedImage();
  const resolution = selectedResolution();
  if (!image || !resolution || !state.previewReady || state.busy) return;
  setCrop(
    image,
    resolution,
    coverCrop(image.width, image.height, resolution.width / resolution.height),
  );
  layoutCrop();
}
function renderPresets() {
  const restoreFocus = preserveFocus($("presets-dialog"));
  const categories = ["All", "Social", "Commerce", "Web", "Original"];
  $("preset-categories").replaceChildren();
  for (const category of categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = category;
    button.dataset.focusKey = `category-${category}`;
    button.setAttribute("aria-pressed", String(category === presetCategory));
    button.addEventListener("click", () => {
      presetCategory = category;
      renderPresets();
    });
    $("preset-categories").append(button);
  }
  const search = $("preset-search").value.trim().toLowerCase();
  $("preset-grid").replaceChildren();
  const options = PRESETS.filter(
    (p) =>
      (presetCategory === "All" || p.category === presetCategory) &&
      `${p.name} ${p.category} ${p.width} ${p.height} ${sizeKey(p)}`
        .toLowerCase()
        .includes(search),
  );
  for (const preset of options) {
    const key = sizeKey(preset);
    const selected = state.resolutions.some((size) => sizeKey(size) === key);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset-option";
    button.dataset.focusKey = `preset-${key}`;
    button.disabled = state.busy;
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute(
      "aria-label",
      `${selected ? "Remove" : "Add"} ${preset.name}`,
    );
    const info = document.createElement("span");
    info.className = "size-info";
    const name = document.createElement("strong");
    name.textContent = preset.name;
    const dims = document.createElement("small");
    dims.textContent = `${preset.width} × ${preset.height} · ${preset.category}`;
    info.append(name, dims);
    const mark = document.createElement("span");
    mark.innerHTML = icon(selected ? "check" : "plus");
    button.append(shape(preset), info, mark);
    button.addEventListener("click", () => {
      if (selected) removeResolution(key);
      else if (addResolution(preset)) {
        toast(`${preset.name} added to your output sizes.`);
      }
    });
    $("preset-grid").append(button);
  }
  if (!options.length) {
    const empty = document.createElement("p");
    empty.className = "preset-empty";
    empty.textContent =
      "No matching sizes. Try another search or add a custom size.";
    $("preset-grid").append(empty);
  }
  restoreFocus();
}
function openPresets() {
  renderPresets();
  $("presets-dialog").showModal();
}
function openHelp() {
  $("help-dialog").showModal();
}
function setTheme() {
  document.documentElement.dataset.theme = state.theme;
  $("theme-toggle").innerHTML = icon(state.theme === "dark" ? "sun" : "moon");
  $("theme-toggle").setAttribute(
    "aria-label",
    `Switch to ${state.theme === "dark" ? "light" : "dark"} theme`,
  );
  document.querySelector('meta[name="theme-color"]').content =
    state.theme === "dark" ? "#191e1a" : "#f6f7f4";
}
function renderResults(results) {
  state.results = results;
  $("results").replaceChildren();
  $("results-empty").hidden = Boolean(results.length);
  const successes = results.filter((result) => !result.error);
  const failed = results.length - successes.length;
  $("export-count").textContent = successes.length;
  const bytes = successes.reduce((sum, result) => sum + (result.size || 0), 0);
  $("results-summary").textContent = successes.length
    ? `${successes.length} ${successes.length === 1 ? "image" : "images"} exported${bytes ? ` · ${formatBytes(bytes)}` : ""}${failed ? ` · ${failed} failed` : ""}. ${isWeb ? "Your ZIP download is ready." : "Your export folder is ready."}`
    : "No images were exported. Review the details below and try again.";
  for (const result of results) {
    const item = document.createElement("li");
    item.classList.toggle("fail", Boolean(result.error));
    const mark = document.createElement("span");
    mark.className = "result-icon";
    mark.innerHTML = icon(result.error ? "help" : "check");
    const meta = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = (result.outputPath || result.source || "Export failed")
      .split(/[\\/]/)
      .pop();
    const detail = document.createElement("small");
    detail.textContent =
      result.error ||
      `${result.width} × ${result.height} · ${(result.format || state.format).toUpperCase()}${result.size ? ` · ${formatBytes(result.size)}` : ""}`;
    meta.append(name, detail);
    item.append(mark, meta);
    if (!isWeb && result.outputPath) {
      const reveal = document.createElement("button");
      reveal.type = "button";
      reveal.className = "text-button";
      reveal.textContent = "Show file";
      reveal.addEventListener("click", () =>
        window.api
          .revealItem(result.outputPath)
          .catch((error) => toast(error.message, true)),
      );
      item.append(reveal);
    }
    $("results").append(item);
  }
}
function setProgress(percent, label) {
  $("progress").hidden = false;
  $("progress-bar").style.width = `${Math.max(0, Math.min(100, percent))}%`;
  $("progress").setAttribute("aria-valuenow", String(Math.round(percent)));
  $("progress-label").textContent = label;
}
async function runExport() {
  if (
    state.busy ||
    state.importing ||
    !usableImages().length ||
    !state.resolutions.length
  )
    return;
  state.busy = true;
  updateActions();
  $("results-panel").hidden = false;
  $("results").replaceChildren();
  $("results-summary").textContent = "";
  $("results-empty").hidden = true;
  setProgress(0, "Preparing…");
  try {
    const { results, outputDir } = await window.api.resizeImages({
      images: usableImages(),
      resolutions: state.resolutions.map((size) => ({ ...size })),
      crops: structuredClone(state.crops),
      outputDir: state.outputDir,
      format: state.format,
      quality: state.quality,
      includeOriginals: state.includeOriginals,
      maxBytes: state.limitFileSize ? MAX_EXPORT_BYTES : null,
    });
    state.lastRunDir = outputDir || "";
    renderResults(results);
    const succeeded = results.filter((result) => !result.error).length;
    setProgress(
      100,
      succeeded === results.length
        ? "Export complete"
        : "Completed with errors",
    );
    toast(
      succeeded
        ? `${succeeded} ${succeeded === 1 ? "image" : "images"} ready. ${isWeb ? "Check your downloads." : "Your export folder is ready."}`
        : "Export failed. See the activity details.",
      !succeeded,
    );
  } catch (error) {
    renderResults([{ error: error.message || "Could not export images." }]);
    setProgress(0, "Export failed");
    toast(error.message || "Export failed. Please try again.", true);
  } finally {
    state.busy = false;
    updateActions();
  }
}

$("add-images").addEventListener("click", pickImages);
$("empty-upload").addEventListener("click", pickImages);
$("drop-zone").addEventListener("click", pickImages);
$("drop-zone").addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    pickImages();
  }
});
$("load-demo").addEventListener("click", () =>
  importImages(async () => {
    if (window.api.loadSampleImage) return window.api.loadSampleImage();
    const response = await fetch("./sample.svg");
    if (!response.ok) throw new Error("Sample image could not load.");
    return window.api.inspectFiles([
      new File([await response.blob()], "quiet-landscape.svg", {
        type: "image/svg+xml",
      }),
    ]);
  }),
);
$("clear-images").addEventListener("click", () => {
  if (state.busy || state.importing) return;
  for (const image of [...state.images]) removeImage(imageKey(image));
  toast("Workspace cleared. Your original files are unchanged.");
});
// Prevent dropped files from navigating away from the workspace.
for (const name of ["dragover", "drop"])
  window.addEventListener(name, (event) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
for (const name of ["dragenter", "dragover"])
  $("drop-zone").addEventListener(name, (event) => {
    event.preventDefault();
    if (!state.busy && !state.importing) $("drop-zone").classList.add("active");
  });
for (const name of ["dragleave", "drop"])
  $("drop-zone").addEventListener(name, () =>
    $("drop-zone").classList.remove("active"),
  );
$("drop-zone").addEventListener("drop", (event) => {
  const files = [...event.dataTransfer.files];
  if (!files.length) return;
  importImages(() =>
    window.api.inspectFiles
      ? window.api.inspectFiles(files)
      : window.api.inspectPaths(
          files.map((file) => window.api.getPathForFile(file)).filter(Boolean),
        ),
  );
});
$("res-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.busy) return;
  const size = {
    width: Number($("res-width").value),
    height: Number($("res-height").value),
    name: "Custom size",
  };
  try {
    validateResolutions([size]);
  } catch (error) {
    toast(error.message, true);
    return;
  }
  if (addResolution(size)) {
    $("res-form").reset();
    toast(`${size.width} × ${size.height} added.`);
  }
});
$("open-presets").addEventListener("click", openPresets);
$("browse-presets").addEventListener("click", openPresets);
$("preset-search").addEventListener("input", renderPresets);
for (const id of ["help-button", "how-it-works", "shortcuts-footer"])
  $(id).addEventListener("click", openHelp);
document
  .querySelectorAll("[data-close-dialog]")
  .forEach((button) =>
    button.addEventListener("click", () => button.closest("dialog").close()),
  );
document.querySelectorAll("dialog").forEach((dialog) =>
  dialog.addEventListener("click", (event) => {
    const r = dialog.getBoundingClientRect();
    if (
      event.target === dialog &&
      (event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom)
    )
      dialog.close();
  }),
);
$("open-exports").addEventListener("click", () => {
  $("results-panel").hidden = false;
  $("results-panel").scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
    block: "center",
  });
});
$("theme-toggle").addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  setTheme();
  saveSettings();
});
$("toggle-grid").addEventListener("click", () => {
  state.showGrid = !state.showGrid;
  $("crop-viewport").classList.toggle("hide-grid", !state.showGrid);
  $("toggle-grid").setAttribute("aria-pressed", String(state.showGrid));
});
document.querySelectorAll("[data-format]").forEach((button) =>
  button.addEventListener("click", () => {
    if (state.busy) return;
    state.format = button.dataset.format;
    renderFormat();
    saveSettings();
  }),
);
$("quality-range").addEventListener("input", () => {
  state.quality = Number($("quality-range").value) / 100;
  $("quality-value").value = `${Math.round(state.quality * 100)}%`;
  saveSettings();
});
$("include-originals").addEventListener("change", () => {
  state.includeOriginals = $("include-originals").checked;
  saveSettings();
});
$("size-limit").addEventListener("change", () => {
  state.limitFileSize = $("size-limit").checked;
  renderFormat();
  saveSettings();
});
$("retry-preview").addEventListener("click", refreshPreview);
$("reset-crop").addEventListener("click", resetCrop);
$("zoom-range").addEventListener("input", () =>
  zoomTo(Number($("zoom-range").value)),
);
$("zoom-in").addEventListener("click", () =>
  zoomTo(Number($("zoom-range").value) + 10),
);
$("zoom-out").addEventListener("click", () =>
  zoomTo(Number($("zoom-range").value) - 10),
);
$("crop-viewport").addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || state.busy || state.importing) return;
  drag = { x: event.clientX, y: event.clientY };
  $("crop-viewport").classList.add("dragging");
  $("crop-viewport").setPointerCapture(event.pointerId);
  $("crop-viewport").focus({ preventScroll: true });
});
$("crop-viewport").addEventListener("pointermove", (event) => {
  if (!drag) return;
  panCrop(event.clientX - drag.x, event.clientY - drag.y);
  drag = { x: event.clientX, y: event.clientY };
});
for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
  $("crop-viewport").addEventListener(name, () => {
    drag = null;
    $("crop-viewport").classList.remove("dragging");
  });
$("crop-viewport").addEventListener(
  "wheel",
  (event) => {
    if (document.activeElement !== $("crop-viewport")) return;
    event.preventDefault();
    zoomTo(Number($("zoom-range").value) + (event.deltaY > 0 ? -5 : 5));
  },
  { passive: false },
);
document.addEventListener("keydown", (event) => {
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.target.closest("input,textarea,select,[contenteditable=true]") ||
    document.querySelector("dialog[open]")
  )
    return;
  if (event.key === "?") {
    event.preventDefault();
    openHelp();
    return;
  }
  if (event.key.toLowerCase() === "o") {
    event.preventDefault();
    pickImages();
    return;
  }
  if (!selectedImage() || state.busy || state.importing) return;
  const step = event.shiftKey ? 10 : 2;
  const actions = {
    ArrowLeft: () => panCrop(-step, 0),
    ArrowRight: () => panCrop(step, 0),
    ArrowUp: () => panCrop(0, -step),
    ArrowDown: () => panCrop(0, step),
    "+": () => zoomTo(Number($("zoom-range").value) + 10),
    "=": () => zoomTo(Number($("zoom-range").value) + 10),
    "-": () => zoomTo(Number($("zoom-range").value) - 10),
    0: resetCrop,
  };
  // Keep native keyboard behavior for controls such as buttons and details.
  if (event.target.closest("button,a,summary")) return;
  if (actions[event.key]) {
    event.preventDefault();
    actions[event.key]();
  }
});
$("rescale").addEventListener("click", runExport);
$("choose-output").addEventListener("click", async () => {
  try {
    const folder = await window.api.pickOutputFolder();
    if (folder) {
      state.outputDir = folder;
      $("output-path").textContent = folder;
    }
  } catch (error) {
    toast(error.message, true);
  }
});
$("reveal-output").addEventListener("click", async () => {
  try {
    await window.api.revealFolder(state.lastRunDir || state.outputDir);
  } catch (error) {
    toast(error.message, true);
  }
});
window.api.onResizeProgress?.((data) => {
  const label =
    data.phase === "packaging"
      ? "Packing your ZIP…"
      : data.done
        ? "Export complete"
        : data.phase === "preparing"
          ? "Preparing originals…"
          : `Processing ${data.current} of ${data.total}`;
  setProgress(
    data.percent ?? (data.total ? (data.current / data.total) * 100 : 0),
    label,
  );
});
const resizeObserver = new ResizeObserver(layoutCrop);
resizeObserver.observe($("crop-stage"));
resizeObserver.observe($("output-preview-frame"));
window.addEventListener("beforeunload", (event) => {
  if (state.busy) {
    event.preventDefault();
    event.returnValue = "";
  }
});
async function init() {
  setTheme();
  renderImages();
  renderResolutions();
  renderFormat();
  updateActions();
  if (!isWeb) {
    $("output-hint").innerHTML =
      `${icon("folder")}Saved to a dated export folder`;
    $("output-actions").hidden = false;
    $("output-path").hidden = false;
    try {
      state.outputDir = await window.api.getDefaultOutput();
      $("output-path").textContent = state.outputDir;
    } catch (error) {
      toast(error.message, true);
    }
  }
}
init();
if (import.meta.env.DEV)
  window.__imageRescaler = {
    getState: () => structuredClone(state),
    addResolution,
    addImagesFromPaths: async (paths) =>
      addImages(await window.api.inspectPaths(paths)),
  };
