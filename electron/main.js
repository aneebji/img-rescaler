const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const sharp = require("sharp");

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
];

function isDev() {
  return !app.isPackaged;
}

function getDefaultOutputDir() {
  if (!app.isPackaged) {
    return path.join(process.cwd(), "output");
  }

  const exe = app.getPath("exe");
  const appBundle = path.resolve(exe, "..", "..", "..");
  return path.join(path.dirname(appBundle), "output");
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

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 860,
    minWidth: 900,
    minHeight: 720,
    title: "Image Rescaler",
    backgroundColor: "#141414",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

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

ipcMain.handle("get-default-output", () => getDefaultOutputDir());

ipcMain.handle("pick-images", async () => {
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

ipcMain.handle("inspect-paths", async (_event, filePaths) => {
  return readImageInfos(filePaths);
});

ipcMain.handle("get-image-preview", async (_event, filePath) => {
  return readImagePreview(filePath);
});

ipcMain.handle("pick-output-folder", async () => {
  const result = await dialog.showOpenDialog({
    title: "Choose output folder",
    properties: ["openDirectory", "createDirectory"],
  });

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle("reveal-item", (_event, filePath) => {
  if (filePath) {
    shell.showItemInFolder(filePath);
  }
});

ipcMain.handle("reveal-folder", async (_event, folderPath) => {
  if (!folderPath) {
    return;
  }

  await fs.mkdir(folderPath, { recursive: true });
  await shell.openPath(folderPath);
});

ipcMain.handle(
  "resize-images",
  async (event, { images, resolutions, outputDir, crops }) => {
    const parent = outputDir || getDefaultOutputDir();
    const dest = await createRunDir(parent);

    const jobs = [];
    for (const image of images) {
      for (const resolution of resolutions) {
        jobs.push({ image, resolution });
      }
    }

    const results = [];

    for (let index = 0; index < jobs.length; index += 1) {
      const { image, resolution } = jobs[index];
      const presetWidth = Number(resolution.width);
      const presetHeight = Number(resolution.height);
      const cropKey = `${presetWidth}x${presetHeight}`;
      const crop = crops?.[image.path]?.[cropKey];

      event.sender.send("resize-progress", {
        current: index + 1,
        total: jobs.length,
        file: path.basename(image.path),
        preset: cropKey,
      });

      try {
        const result = await resizeOne({
          inputPath: image.path,
          dest,
          presetWidth,
          presetHeight,
          crop,
        });
        results.push(result);
      } catch (error) {
        results.push({
          source: image.path,
          presetWidth,
          presetHeight,
          outputPath: null,
          width: null,
          height: null,
          error: error.message || "Resize failed",
        });
      }
    }

    event.sender.send("resize-progress", {
      current: jobs.length,
      total: jobs.length,
      file: "",
      preset: "",
      done: true,
    });

    return { outputDir: dest, results };
  }
);

async function readImageInfos(filePaths) {
  const infos = [];

  for (const filePath of filePaths) {
    if (!filePath) {
      continue;
    }

    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        continue;
      }

      const metadata = await sharp(filePath).rotate().metadata();
      infos.push({
        path: filePath,
        name: path.basename(filePath),
        width: metadata.width || 0,
        height: metadata.height || 0,
      });
    } catch (error) {
      infos.push({
        path: filePath,
        name: path.basename(filePath),
        width: 0,
        height: 0,
        error: error.message || "Could not read image",
      });
    }
  }

  return infos;
}

async function readImagePreview(filePath) {
  const metadata = await sharp(filePath).rotate().metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  if (!width || !height) {
    throw new Error("Could not read image size");
  }

  const max = 1600;
  let pipeline = sharp(filePath).rotate();

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
}) {
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext);
  const outputPath = path.join(
    dest,
    `${base}_${presetWidth}x${presetHeight}.png`
  );

  const metadata = await sharp(inputPath).rotate().metadata();
  const region = normalizeCrop(
    crop,
    metadata.width || 0,
    metadata.height || 0,
    presetWidth,
    presetHeight
  );

  const info = await sharp(inputPath)
    .rotate()
    .extract(region)
    .resize(presetWidth, presetHeight, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
    })
    .png({
      compressionLevel: 9,
      effort: 10,
    })
    .toFile(outputPath);

  return {
    source: inputPath,
    presetWidth,
    presetHeight,
    outputPath,
    width: info.width,
    height: info.height,
    error: null,
  };
}
