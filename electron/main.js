const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const sharp = require("sharp");
const exportUtils = import("../src/export-utils.mjs");

let psdDecodePromise;

function loadPsdDecode() {
  if (!psdDecodePromise) {
    psdDecodePromise = import(
      pathToFileURL(path.join(__dirname, "psd-decode.mjs")).href
    );
  }
  return psdDecodePromise;
}

const IMAGE_FILTER_EXTENSIONS = [
  "jpg",
  "jpeg",
  "jfif",
  "png",
  "webp",
  "gif",
  "avif",
  "tif",
  "tiff",
  "bmp",
  "ico",
  "svg",
  "heic",
  "heif",
  "psd",
  "psb",
];

const psdRasterCache = new Map();

async function resolveInput(filePath) {
  const { isPsdFileName, decodePsdComposite } = await loadPsdDecode();
  if (!isPsdFileName(filePath)) {
    return filePath;
  }

  const cached = psdRasterCache.get(filePath);
  if (cached) {
    return cached;
  }

  const { width, height, rgba } = decodePsdComposite(
    await fs.readFile(filePath),
  );
  const dest = path.join(
    os.tmpdir(),
    `image-rescaler-${crypto.createHash("sha1").update(filePath).digest("hex")}.png`,
  );
  await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
    raw: { width, height, channels: 4 },
  })
    .png({ compressionLevel: 1 })
    .toFile(dest);

  psdRasterCache.set(filePath, dest);
  return dest;
}

function isDev() {
  return !app.isPackaged;
}

function getDefaultOutputDir() {
  if (!app.isPackaged) {
    return path.join(process.cwd(), "output");
  }

  return path.join(app.getPath("pictures"), "Image Rescaler");
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatRunStamp(date = new Date()) {
  return [
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    `${pad2(date.getHours())}-${pad2(date.getMinutes())}-${pad2(date.getSeconds())}`,
  ].join("_");
}

async function uniqueDestName(dir, fileName) {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext);
  let dest = path.join(dir, fileName);
  let suffix = 2;

  while (true) {
    try {
      await fs.access(dest);
      dest = path.join(dir, `${stem}-${suffix}${ext}`);
      suffix += 1;
    } catch {
      return dest;
    }
  }
}

async function copyOriginals(dest, images) {
  const originalsDir = path.join(dest, "originals");
  await fs.mkdir(originalsDir, { recursive: true });
  const seen = new Set();

  for (const image of images) {
    const source = image.path;
    if (!source || seen.has(source)) {
      continue;
    }
    seen.add(source);
    const target = await uniqueDestName(originalsDir, path.basename(source));
    await fs.copyFile(source, target);
  }
}

async function createRunDir(parent) {
  await fs.mkdir(parent, { recursive: true });

  const stamp = formatRunStamp();
  let dest = path.join(parent, stamp);
  let suffix = 2;

  while (true) {
    try {
      await fs.mkdir(dest);
      return dest;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      dest = path.join(parent, `${stamp}-${suffix}`);
      suffix += 1;
    }
  }
}

function validPath(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    const source = event.senderFrame;
    const url = source?.url || "";
    const expectedFile = pathToFileURL(
      path.join(__dirname, "..", "dist-renderer", "index.html"),
    ).href;
    const trusted = isDev()
      ? /^http:\/\/127\.0\.0\.1:5173(?:\/|$)/.test(url)
      : url.split("#")[0] === expectedFile;
    if (!trusted || source !== event.sender.mainFrame)
      throw new Error("Untrusted application request.");
    return callback(event, ...args);
  });
}

function openTrustedExternal(value) {
  try {
    const url = new URL(value);
    const repositoryPath = "/aneebji/img-rescaler";
    const allowedPath =
      url.pathname === repositoryPath ||
      url.pathname.startsWith(`${repositoryPath}/`);
    if (
      url.origin !== "https://github.com" ||
      url.username ||
      url.password ||
      !allowedPath
    )
      return;
    void shell
      .openExternal(url.href)
      .catch((error) => console.error("Could not open repository link", error));
  } catch {
    // Ignore malformed URLs and keep the renderer in its local application page.
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 950,
    minWidth: 780,
    minHeight: 650,
    title: "Image Rescaler",
    backgroundColor: "#f6f7f4",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openTrustedExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());

  if (isDev()) {
    win.loadURL("http://127.0.0.1:5173");
  } else {
    win.loadFile(path.join(__dirname, "..", "dist-renderer", "index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

handle("get-default-output", () => getDefaultOutputDir());

handle("load-sample-image", () =>
  readImageInfos([
    isDev()
      ? path.join(__dirname, "..", "src/public", "sample.svg")
      : path.join(process.resourcesPath, "sample.svg"),
  ]),
);

handle("pick-images", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose images",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Images",
        extensions: IMAGE_FILTER_EXTENSIONS,
      },
      {
        name: "All files",
        extensions: ["*"],
      },
    ],
  });

  if (result.canceled) {
    return [];
  }

  return readImageInfos(result.filePaths);
});

handle("inspect-paths", async (_event, filePaths) => {
  return readImageInfos(filePaths);
});

handle("get-image-preview", async (_event, filePath) => {
  return readImagePreview(filePath);
});

handle("pick-output-folder", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose output folder",
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  return result.filePaths[0];
});

handle("reveal-item", (_event, filePath) => {
  if (validPath(filePath)) {
    shell.showItemInFolder(filePath);
  }
});

handle("reveal-folder", async (_event, folderPath) => {
  if (!validPath(folderPath)) {
    return;
  }

  await fs.mkdir(folderPath, { recursive: true });
  await shell.openPath(folderPath);
});

handle("resize-images", async (event, payload = {}) => {
  const { normalizeExportOptions, validateResolutions } = await exportUtils;
  const options = normalizeExportOptions(payload);
  const resolutions = validateResolutions(payload.resolutions);
  const { images, crops, outputDir } = payload;
  if (
    !Array.isArray(images) ||
    !images.length ||
    images.some((image) => !validPath(image?.path))
  ) {
    throw new Error("Add at least one valid image to export.");
  }
  if (outputDir != null && !validPath(outputDir))
    throw new Error("Choose a valid output folder.");
  const parent = outputDir || getDefaultOutputDir();
  const dest = await createRunDir(parent);
  const jobs = images.flatMap((image) =>
    resolutions.map((resolution) => ({ image, resolution })),
  );
  const progress = (data) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send("resize-progress", {
        total: jobs.length,
        file: "",
        preset: "",
        done: false,
        ...data,
      });
    }
  };
  progress({ phase: "preparing", current: 0, percent: 0 });
  if (options.includeOriginals) await copyOriginals(dest, images);
  const results = [];
  const usedOutputs = new Set();

  for (let index = 0; index < jobs.length; index += 1) {
    const { image, resolution } = jobs[index];
    const presetWidth = resolution.width;
    const presetHeight = resolution.height;
    const cropKey = `${presetWidth}x${presetHeight}`;
    const crop = crops?.[image.id]?.[cropKey] || crops?.[image.path]?.[cropKey];
    progress({
      phase: "resizing",
      current: index,
      percent: (index / jobs.length) * 99,
      file: path.basename(image.path),
      preset: cropKey,
    });
    try {
      results.push(
        await resizeOne({
          inputPath: image.path,
          dest,
          presetWidth,
          presetHeight,
          crop,
          usedOutputs,
          ...options,
        }),
      );
    } catch (error) {
      results.push({
        source: image.path,
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
      percent: ((index + 1) / jobs.length) * 99,
      file: path.basename(image.path),
      preset: cropKey,
    });
  }
  progress({
    phase: "complete",
    current: jobs.length,
    percent: 100,
    done: true,
  });
  return { outputDir: dest, results };
});

async function readImageInfos(filePaths) {
  if (!Array.isArray(filePaths))
    throw new Error("Choose image files to inspect.");
  const { orientedDimensions } = await exportUtils;
  const infos = [];

  for (const filePath of filePaths) {
    if (!validPath(filePath)) continue;
    let size = 0;
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        continue;
      }

      size = stat.size;
      const source = await resolveInput(filePath);
      const metadata = await sharp(source).metadata();
      const { width, height } = orientedDimensions(metadata);
      if (!width || !height)
        throw new Error("Could not read image dimensions.");
      infos.push({
        id: filePath,
        path: filePath,
        name: path.basename(filePath),
        width,
        height,
        size,
      });
    } catch (error) {
      infos.push({
        id: filePath,
        path: filePath,
        name: path.basename(filePath),
        width: 0,
        height: 0,
        size,
        error: error.message || "Could not read image",
      });
    }
  }

  return infos;
}

async function readImagePreview(filePath) {
  if (!validPath(filePath)) throw new Error("Choose a valid image file.");
  const { orientedDimensions } = await exportUtils;
  const source = await resolveInput(filePath);
  const metadata = await sharp(source).metadata();
  const { width, height } = orientedDimensions(metadata);

  if (!width || !height) {
    throw new Error("Could not read image size");
  }

  const max = 1600;
  let pipeline = sharp(source).rotate();

  if (width > max || height > max) {
    pipeline = pipeline.resize(max, max, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  const usePng = Boolean(metadata.hasAlpha);
  const buffer = usePng
    ? await pipeline.png({ compressionLevel: 3 }).toBuffer()
    : await pipeline.jpeg({ quality: 86 }).toBuffer();
  const previewMeta = await sharp(buffer).metadata();
  const mime = usePng ? "image/png" : "image/jpeg";

  return {
    dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
    width,
    height,
    previewWidth: previewMeta.width || width,
    previewHeight: previewMeta.height || height,
  };
}

async function resizeOne({
  inputPath,
  dest,
  presetWidth,
  presetHeight,
  crop,
  usedOutputs,
  format,
  quality,
  maxBytes,
}) {
  const {
    fitExport,
    normalizeCrop,
    orientedDimensions,
    outputFileName,
    uniqueName,
  } = await exportUtils;
  const source = await resolveInput(inputPath);
  const metadata = await sharp(source).metadata();
  const { width, height } = orientedDimensions(metadata);
  const region = normalizeCrop(crop, width, height, presetWidth, presetHeight);
  const raw = await sharp(source)
    .rotate()
    .extract(region)
    .resize(presetWidth, presetHeight, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const encode = async (targetWidth, targetHeight, encoderQuality) => {
    let pipeline = sharp(raw.data, {
      raw: {
        width: raw.info.width,
        height: raw.info.height,
        channels: raw.info.channels,
      },
    });
    if (targetWidth !== raw.info.width || targetHeight !== raw.info.height) {
      pipeline = pipeline.resize(targetWidth, targetHeight, {
        fit: "fill",
        kernel: sharp.kernel.lanczos3,
      });
    }
    if (format === "jpeg") {
      pipeline = pipeline.flatten({ background: "#ffffff" }).jpeg({
        quality: encoderQuality,
        mozjpeg: true,
      });
    } else if (format === "webp") {
      pipeline = pipeline.webp({ quality: encoderQuality, effort: 5 });
    } else if (encoderQuality == null) {
      pipeline = pipeline.png({ compressionLevel: 9 });
    } else {
      pipeline = pipeline.png({
        compressionLevel: 9,
        palette: true,
        quality: encoderQuality,
        effort: 7,
      });
    }
    const data = await pipeline.toBuffer();
    return { byteLength: data.length, payload: data };
  };
  const fitted = await fitExport({
    width: presetWidth,
    height: presetHeight,
    format,
    quality,
    maxBytes,
    encode,
    allowPalette: format === "png",
  });
  const name = uniqueName(
    usedOutputs,
    outputFileName(
      path.basename(inputPath),
      fitted.width,
      fitted.height,
      format,
    ),
  );
  const outputPath = await uniqueDestName(dest, name);
  await fs.writeFile(outputPath, fitted.payload);
  return {
    source: inputPath,
    presetWidth,
    presetHeight,
    outputPath,
    width: fitted.width,
    height: fitted.height,
    format,
    size: fitted.byteLength,
    error: null,
  };
}
