const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const Module = require("node:module");
const sharp = require("sharp");

let helpers;
let temp;
let portrait;
let transparent;
let duplicate;
let corrupt;
const handlers = new Map();
let onReady;
let openWindow;
let navigate;
let windowOptions;
const externalUrls = [];
const originalLoad = Module._load;
try {
  Module._load = function (request, ...args) {
    if (request === "electron") {
      return {
        app: {
          isPackaged: false,
          whenReady: () => ({
            then: (callback) => {
              onReady = callback;
            },
          }),
          on() {},
        },
        ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
        BrowserWindow: class {
          constructor(options) {
            windowOptions = options;
            this.webContents = {
              setWindowOpenHandler: (callback) => {
                openWindow = callback;
              },
              on: (_event, callback) => {
                navigate = callback;
              },
            };
          }
          loadURL() {}
        },
        shell: {
          openExternal: async (url) => {
            externalUrls.push(url);
          },
        },
      };
    }
    return originalLoad.call(this, request, ...args);
  };
  require("../electron/main.js");
} finally {
  Module._load = originalLoad;
}

function eventFor(progress = []) {
  const senderFrame = { url: "http://127.0.0.1:5173/" };
  return {
    senderFrame,
    sender: {
      mainFrame: senderFrame,
      isDestroyed: () => false,
      send: (_channel, value) => progress.push(value),
    },
  };
}

before(async () => {
  helpers = await import("../src/export-utils.mjs");
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "image-rescaler-test-"));
  portrait = path.join(temp, "portrait.jpg");
  transparent = path.join(temp, "photo.png");
  duplicate = path.join(temp, "photo.jpg");
  corrupt = path.join(temp, "corrupt.png");
  await sharp({
    create: { width: 120, height: 80, channels: 3, background: "#ef4444" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toFile(portrait);
  await sharp({
    create: {
      width: 120,
      height: 80,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toFile(transparent);
  await sharp({
    create: { width: 120, height: 80, channels: 3, background: "#3b82f6" },
  })
    .jpeg()
    .toFile(duplicate);
  await fs.writeFile(corrupt, "not an image");
});

after(async () => {
  if (temp) await fs.rm(temp, { recursive: true, force: true });
});

test("export defaults remain backward compatible and unsupported options are rejected", () => {
  assert.deepEqual(helpers.normalizeExportOptions(), {
    format: "png",
    quality: 0.9,
    includeOriginals: true,
  });
  for (const quality of [0, 0.5, 1])
    assert.equal(helpers.normalizeExportOptions({ quality }).quality, quality);
  for (const options of [
    { format: "gif" },
    { quality: -0.1 },
    { quality: 1.1 },
    { quality: NaN },
    { quality: "0.9" },
    { includeOriginals: "false" },
  ]) {
    assert.throws(() => helpers.normalizeExportOptions(options));
  }
});

test("output validation enforces whole pixels, side and total-area limits", () => {
  assert.deepEqual(
    helpers.validateResolutions([{ width: "8192", height: "1" }]),
    [{ width: 8192, height: 1 }],
  );
  assert.equal(
    helpers.validateResolutions([{ width: 8000, height: 4000 }])[0].width,
    8000,
  );
  for (const sizes of [
    [],
    [{ width: 0, height: 10 }],
    [{ width: 2.5, height: 10 }],
    [{ width: true, height: 10 }],
    [{ width: 8193, height: 1 }],
    [{ width: 8192, height: 8192 }],
  ]) {
    assert.throws(() => helpers.validateResolutions(sizes));
  }
});

test("center crop uses the target ratio and invalid crop values fall back safely", () => {
  const expected = { left: 100, top: 0, width: 400, height: 400 };
  assert.deepEqual(helpers.normalizeCrop(null, 600, 400, 100, 100), expected);
  assert.deepEqual(
    helpers.normalizeCrop(
      { left: NaN, top: 0, width: 10, height: 20 },
      600,
      400,
      100,
      100,
    ),
    expected,
  );
  assert.throws(() => helpers.normalizeCrop(null, 0, 400, 100, 100));
});

test("crops stay inside image bounds even when dragged beyond every edge", () => {
  for (const left of [-1000, -1, 0, 20.4, 99.9, 1000]) {
    for (const top of [-1000, -1, 0, 39.9, 1000]) {
      const region = helpers.normalizeCrop(
        { left, top, width: 240.5, height: 230.5 },
        100,
        40,
        30,
        30,
      );
      assert.ok(Object.values(region).every(Number.isInteger));
      assert.ok(
        region.left >= 0 &&
          region.top >= 0 &&
          region.width >= 1 &&
          region.height >= 1,
      );
      assert.ok(
        region.left + region.width <= 100 && region.top + region.height <= 40,
      );
    }
  }
});

test("output names cannot traverse folders and collisions are case insensitive", () => {
  assert.equal(
    helpers.outputFileName("../../photo.jpg", 100, 200, "jpeg"),
    "photo_100x200.jpg",
  );
  assert.equal(helpers.safeFileName("..\\folder\\CON.png"), "image-CON.png");
  const used = new Set();
  assert.equal(helpers.uniqueName(used, "Photo.png"), "Photo.png");
  assert.equal(helpers.uniqueName(used, "photo.png"), "photo-2.png");
  assert.equal(helpers.uniqueName(used, "photo.png"), "photo-3.png");
});

test("EXIF orientation swaps only the correct dimensions", () => {
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const actual = helpers.orientedDimensions({
      width: 120,
      height: 80,
      orientation,
    });
    assert.deepEqual(
      actual,
      orientation >= 5
        ? { width: 80, height: 120 }
        : { width: 120, height: 80 },
    );
  }
});

test("desktop inspection and preview agree on oriented dimensions and preserve alpha", async () => {
  const infos = await handlers.get("inspect-paths")(eventFor(), [
    portrait,
    transparent,
    corrupt,
  ]);
  assert.deepEqual([infos[0].width, infos[0].height], [80, 120]);
  assert.equal(infos[0].size, (await fs.stat(portrait)).size);
  assert.ok(infos[2].error);
  const preview = await handlers.get("get-image-preview")(eventFor(), portrait);
  assert.deepEqual(
    [
      preview.width,
      preview.height,
      preview.previewWidth,
      preview.previewHeight,
    ],
    [80, 120, 80, 120],
  );
  const alphaPreview = await handlers.get("get-image-preview")(
    eventFor(),
    transparent,
  );
  const metadata = await sharp(
    Buffer.from(alphaPreview.dataUrl.split(",")[1], "base64"),
  ).metadata();
  assert.equal(metadata.hasAlpha, true);
});

for (const format of ["png", "jpeg", "webp"]) {
  test(`desktop ${format} exports exact dimensions, preserves duplicate filenames, and completes after files are ready`, async () => {
    const progress = [];
    const output = await handlers.get("resize-images")(eventFor(progress), {
      images: [{ path: portrait }, { path: transparent }, { path: duplicate }],
      resolutions: [{ width: 30, height: 50 }],
      outputDir: path.join(temp, `output-${format}`),
      crops: {
        [portrait]: { "30x50": { left: 10, top: 20, width: 60, height: 100 } },
      },
      format,
      quality: 0.9,
      includeOriginals: false,
    });
    assert.equal(output.results.length, 3);
    assert.equal(
      new Set(output.results.map((result) => result.outputPath)).size,
      3,
    );
    for (const result of output.results) {
      assert.equal(result.error, null);
      assert.equal(result.format, format);
      assert.ok(result.size > 0);
      const metadata = await sharp(result.outputPath).metadata();
      assert.deepEqual(
        [metadata.width, metadata.height, metadata.format],
        [30, 50, format],
      );
    }
    const alphaResult = output.results[1];
    const { data, info } = await sharp(alphaResult.outputPath)
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (format === "jpeg") {
      assert.equal(info.channels, 3);
      assert.ok(
        data[0] >= 250 && data[1] >= 250 && data[2] >= 250,
        "transparent pixels flatten onto white",
      );
    } else {
      assert.equal(info.channels, 4);
      assert.equal(data[3], 0);
    }
    await assert.rejects(fs.access(path.join(output.outputDir, "originals")));
    assert.equal(progress.at(-1).done, true);
    assert.equal(progress.at(-1).percent, 100);
    assert.ok(
      progress
        .slice(0, -1)
        .every((update) => !update.done && update.percent < 100),
    );
  });
}

test("desktop retains originals by default and isolates corrupt-image failures", async () => {
  const output = await handlers.get("resize-images")(eventFor(), {
    images: [{ path: corrupt }, { path: transparent }],
    resolutions: [{ width: 25, height: 25 }],
    outputDir: path.join(temp, "partial-output"),
  });
  assert.ok(output.results[0].error);
  assert.equal(output.results[1].error, null);
  assert.deepEqual(
    await fs.readFile(path.join(output.outputDir, "originals", "photo.png")),
    await fs.readFile(transparent),
  );
});

test("desktop rejects remote frames before invoking filesystem operations", () => {
  const event = eventFor();
  event.senderFrame.url = "https://example.com/";
  assert.throws(() => handlers.get("get-default-output")(event), /Untrusted/);
});

test("desktop sample loads from the bundled asset", async () => {
  const infos = await handlers.get("load-sample-image")(eventFor());
  assert.equal(infos.length, 1);
  assert.equal(infos[0].error, undefined);
  assert.deepEqual([infos[0].width, infos[0].height], [1800, 1400]);
  assert.ok(infos[0].size > 0);
});

test("desktop opens only the project repository externally and always blocks renderer navigation", () => {
  onReady();
  assert.deepEqual(
    [
      windowOptions.width,
      windowOptions.height,
      windowOptions.minWidth,
      windowOptions.minHeight,
    ],
    [1400, 950, 780, 650],
  );
  const allowed = [
    "https://github.com/aneebji/img-rescaler",
    "https://github.com/aneebji/img-rescaler/issues",
  ];
  const denied = [
    "https://example.com/aneebji/img-rescaler",
    "http://github.com/aneebji/img-rescaler",
    "https://github.com/aneebji/img-rescaler-other",
    "https://github.com/aneebji/other",
    "https://github.com/aneebji/img-rescaler/../other",
    "https://github.com.evil.test/aneebji/img-rescaler",
    "https://user:pass@github.com/aneebji/img-rescaler",
    "file:///tmp/image.png",
    "javascript:alert(1)",
  ];
  for (const url of [...allowed, ...denied])
    assert.deepEqual(openWindow({ url }), { action: "deny" });
  assert.deepEqual(externalUrls, allowed);
  let prevented = false;
  navigate({
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
});
