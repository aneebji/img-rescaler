import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import sharp from "sharp";

async function imageFile(
  name = "studio.png",
  format = "png",
  background = "#419a75",
) {
  const buffer = await sharp({
    create: { width: 192, height: 128, channels: 4, background },
  })
    .toFormat(format)
    .toBuffer();
  return { name, mimeType: `image/${format}`, buffer };
}

function buildUncompressedPsd({ width, height, colorMode, planes }) {
  const plane = width * height;
  const buffer = Buffer.alloc(40 + plane * planes.length);
  buffer.write("8BPS", 0);
  buffer.writeUInt16BE(1, 4);
  buffer.writeUInt16BE(planes.length, 12);
  buffer.writeUInt32BE(height, 14);
  buffer.writeUInt32BE(width, 18);
  buffer.writeUInt16BE(8, 22);
  buffer.writeUInt16BE(colorMode, 24);
  buffer.writeUInt16BE(0, 38);
  let offset = 40;
  for (const data of planes) {
    Buffer.from(data).copy(buffer, offset);
    offset += plane;
  }
  return buffer;
}

function cmykPsdFile(
  name = "mosque.psd",
  width = 192,
  height = 128,
  stored = [0, 180, 220, 255],
) {
  const plane = width * height;
  const planes = stored.map((value) => Buffer.alloc(plane, value));
  return {
    name,
    mimeType: "image/vnd.adobe.photoshop",
    buffer: buildUncompressedPsd({
      width,
      height,
      colorMode: 4,
      planes,
    }),
  };
}

async function transparentFile() {
  const tile = await sharp({
    create: { width: 80, height: 80, channels: 4, background: "#419a75" },
  })
    .png()
    .toBuffer();
  const buffer = await sharp({
    create: {
      width: 192,
      height: 128,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: tile, left: 56, top: 24 }])
    .png()
    .toBuffer();
  return { name: "transparent.png", mimeType: "image/png", buffer };
}

async function upload(page, files, keyboard = false) {
  const chooser = page.waitForEvent("filechooser");
  if (keyboard) await page.locator("#drop-zone").press("Enter");
  else await page.locator("#add-images").click();
  await (await chooser).setFiles(files);
  await expect(page.locator("#image-list > li")).toHaveCount(files.length);
  await expect(page.locator("#workspace")).toHaveAttribute(
    "aria-busy",
    "false",
  );
}

async function setSingleSize(page, width = 96, height = 64) {
  while (await page.locator(".size-remove").count())
    await page.locator(".size-remove").first().click();
  await page.locator(".custom-size summary").click();
  await page.locator("#res-width").fill(String(width));
  await page.locator("#res-height").fill(String(height));
  await page
    .getByRole("button", { name: "Add custom size", exact: true })
    .click();
  await expect(page.locator(".size-row")).toHaveCount(1);
}

async function exportArchive(page) {
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#rescale").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^ImageRescaler_.*\.zip$/);
  expect(await download.failure()).toBeNull();
  const zip = await JSZip.loadAsync(await readFile(await download.path()));
  await expect(page.locator("#progress")).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  await expect(page.locator("#rescale")).toBeEnabled();
  return Object.values(zip.files).filter((file) => !file.dir);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#add-images")).toBeEnabled();
});

test("sample loads and each output size retains its own keyboard-adjusted crop", async ({
  page,
}) => {
  await expect(page.locator("#rescale")).toBeDisabled();
  await page.locator("#load-demo").click();
  await expect(page.locator("#image-count")).toHaveText("1");
  await expect(page.locator("#crop-image")).toHaveAttribute(
    "src",
    /^data:image\/png/,
  );
  await expect(page.locator("#rescale")).toBeEnabled();
  await page.locator("#crop-viewport").focus();
  await page.keyboard.press("+");
  await expect(page.locator("#zoom-value")).toHaveText("110%");
  const before = await page
    .locator("#crop-frame")
    .evaluate((el) => el.style.left);
  await page.keyboard.press("Shift+ArrowRight");
  await expect
    .poll(() => page.locator("#crop-frame").evaluate((el) => el.style.left))
    .not.toBe(before);
  const squareCrop = await page.locator("#crop-frame").evaluate((el) => ({
    left: el.style.left,
    top: el.style.top,
    width: el.style.width,
    height: el.style.height,
  }));
  await page
    .getByRole("button", { name: "Preview 1080 by 1920", exact: true })
    .click();
  await expect(page.locator("#zoom-value")).toHaveText("100%");
  await page.locator("#zoom-in").click();
  await page.locator("#zoom-in").click();
  await expect(page.locator("#zoom-value")).toHaveText("120%");
  await page
    .getByRole("button", { name: "Preview 1080 by 1080", exact: true })
    .click();
  await expect(page.locator("#zoom-value")).toHaveText("110%");
  expect(
    await page.locator("#crop-frame").evaluate((el) => ({
      left: el.style.left,
      top: el.style.top,
      width: el.style.width,
      height: el.style.height,
    })),
  ).toEqual(squareCrop);
  await page.locator("#crop-viewport").focus();
  await page.keyboard.press("0");
  await expect(page.locator("#zoom-value")).toHaveText("100%");
  await page.locator("#toggle-grid").click();
  await expect(page.locator("#toggle-grid")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
});

for (const format of ["png", "jpeg", "webp"]) {
  test(`${format.toUpperCase()} ZIP contains a decodable exact-size export with correct transparency`, async ({
    page,
  }) => {
    const original = await transparentFile();
    await upload(page, [original]);
    await setSingleSize(page);
    await page.locator(`[data-format="${format}"]`).click();
    await expect(page.locator("#quality-control")).toBeVisible({
      visible: format !== "png",
    });
    const files = await exportArchive(page);
    const originals = files.filter((file) => file.name.includes("/originals/"));
    const outputs = files.filter((file) => !file.name.includes("/originals/"));
    expect(originals).toHaveLength(1);
    expect(await originals[0].async("nodebuffer")).toEqual(original.buffer);
    expect(outputs).toHaveLength(1);
    expect(outputs[0].name).toMatch(
      new RegExp(`transparent_96x64\\.${format === "jpeg" ? "jpg" : format}$`),
    );
    const buffer = await outputs[0].async("nodebuffer");
    const metadata = await sharp(buffer).metadata();
    expect(metadata).toMatchObject({ width: 96, height: 64, format });
    const { data, info } = await sharp(buffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    if (format === "jpeg") {
      expect(metadata.hasAlpha).toBe(false);
      expect([...data.subarray(0, 3)].every((channel) => channel >= 245)).toBe(
        true,
      );
      expect(data[3]).toBe(255);
    } else {
      expect(metadata.hasAlpha).toBe(true);
      expect(data[3]).toBe(0);
    }
    await expect(page.locator("#results-summary")).toContainText(
      "1 image exported",
    );
  });
}

test("batch export preserves duplicate basenames, skips corrupt input, and can omit originals", async ({
  page,
}) => {
  await upload(
    page,
    [
      await imageFile("photo.png", "png", "#ef4444"),
      await imageFile("photo.jpg", "jpeg", "#2563eb"),
      {
        name: "broken.png",
        mimeType: "image/png",
        buffer: Buffer.from("This is not an image."),
      },
    ],
    true,
  );
  await expect(
    page.getByRole("button", { name: "Select broken.png", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("#toast")).toContainText(
    "1 file could not be opened",
  );
  await setSingleSize(page, 80, 80);
  await page.locator("#include-originals").uncheck();
  await expect(page.locator("#export-total")).toHaveText("2 files");
  const files = await exportArchive(page);
  expect(files).toHaveLength(2);
  expect(files.every((file) => !file.name.includes("/originals/"))).toBe(true);
  expect(files.map((file) => file.name.split("/").pop()).sort()).toEqual([
    "photo_80x80-2.png",
    "photo_80x80.png",
  ]);
  const colors = [];
  for (const file of files) {
    const buffer = await file.async("nodebuffer");
    expect(await sharp(buffer).metadata()).toMatchObject({
      width: 80,
      height: 80,
      format: "png",
    });
    const { data } = await sharp(buffer)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    colors.push([...data.subarray(0, 3)]);
  }
  expect(colors[0]).not.toEqual(colors[1]);
  await expect(page.locator("#results > li")).toHaveCount(2);
  await expect(page.locator("#results-summary")).toContainText(
    "2 images exported",
  );
});

test("custom dimensions validate limits and searchable presets remain keyboard accessible", async ({
  page,
}) => {
  await page.locator(".custom-size summary").click();
  await page.locator("#res-width").fill("8192");
  await page.locator("#res-height").fill("8192");
  await page
    .getByRole("button", { name: "Add custom size", exact: true })
    .click();
  await expect(page.locator("#toast")).toContainText("32 megapixels");
  await expect(page.locator(".size-row")).toHaveCount(3);
  await page.locator("#res-width").fill("0");
  await page.locator("#res-height").fill("100");
  await page
    .getByRole("button", { name: "Add custom size", exact: true })
    .click();
  expect(
    await page
      .locator("#res-width")
      .evaluate((el) => el.validity.rangeUnderflow),
  ).toBe(true);
  await expect(page.locator(".size-row")).toHaveCount(3);
  await page.locator("#res-width").fill("112");
  await page.locator("#res-height").fill("70");
  await page
    .getByRole("button", { name: "Add custom size", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Preview 112 by 70", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.locator("#browse-presets").press("Enter");
  await expect(page.locator("#presets-dialog")).toBeVisible();
  await page.locator("#preset-search").fill("Original portrait");
  await expect(page.locator(".preset-option")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Add Original portrait", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("button", { name: "Remove Original portrait", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#presets-dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preview 680 by 1000", exact: true }),
  ).toBeVisible();
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("?");
  await expect(page.locator("#help-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("theme and export settings survive reload while imported images stay session-only", async ({
  page,
}) => {
  await upload(page, [await imageFile()]);
  await setSingleSize(page, 120, 90);
  await page.locator("#theme-toggle").click();
  await page.locator('[data-format="webp"]').click();
  await page.locator("#quality-range").fill("75");
  await page.locator("#include-originals").uncheck();
  await page.locator("#size-limit").uncheck();
  await expect(page.locator("#size-limit-hint")).toHaveText(
    "Original export, with no file-size cap.",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#theme-toggle")).toHaveAccessibleName(
    "Switch to light theme",
  );
  await expect(page.locator('[data-format="webp"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#quality-range")).toHaveValue("75");
  await expect(page.locator("#include-originals")).not.toBeChecked();
  await expect(page.locator("#size-limit")).not.toBeChecked();
  await expect(page.locator("#size-limit-hint")).toHaveText(
    "Original export, with no file-size cap.",
  );
  await expect(page.locator(".size-row")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Preview 120 by 90", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#image-count")).toHaveText("0");
  await expect(page.locator("#rescale")).toBeDisabled();
});

test("loaded workspace and presets fit desktop and narrow mobile viewports without horizontal overflow", async ({
  page,
}) => {
  await page.locator("#load-demo").click();
  await expect(page.locator("#crop-image")).toHaveAttribute(
    "src",
    /^data:image\/png/,
  );
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ]) {
    await page.setViewportSize(viewport);
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              Math.max(
                document.documentElement.scrollWidth,
                document.body.scrollWidth,
              ) <=
              window.innerWidth + 1,
          ),
        { message: `Workspace overflow at ${viewport.width}px` },
      )
      .toBe(true);
    await expect(page.locator("#rescale")).toBeEnabled();
    const stage = await page.locator("#crop-stage").boundingBox();
    expect(stage.width).toBeGreaterThan(100);
    expect(stage.x).toBeGreaterThanOrEqual(0);
    expect(stage.x + stage.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.locator("#browse-presets").click();
    const modal = await page.locator("#presets-dialog").boundingBox();
    expect(modal.x).toBeGreaterThanOrEqual(0);
    expect(modal.x + modal.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.keyboard.press("Escape");
  }
});

test("the 30-size limit reports rejection without clearing custom input or claiming a preset was added", async ({
  page,
}) => {
  await page.evaluate(() =>
    localStorage.setItem(
      "image-rescaler:settings:v2",
      JSON.stringify({
        resolutions: Array.from({ length: 30 }, (_, index) => ({
          width: 100 + index,
          height: 100,
        })),
      }),
    ),
  );
  await page.reload();
  await expect(page.locator(".size-row")).toHaveCount(30);
  await page.locator(".custom-size summary").click();
  await page.locator("#res-width").fill("150");
  await page.locator("#res-height").fill("150");
  await page
    .getByRole("button", { name: "Add custom size", exact: true })
    .click();
  await expect(page.locator("#toast")).toHaveText(
    "Use up to 30 output sizes in one batch.",
  );
  await expect(page.locator("#res-width")).toHaveValue("150");
  await expect(page.locator("#res-height")).toHaveValue("150");
  await expect(page.locator(".size-row")).toHaveCount(30);
  await expect(
    page.getByRole("button", { name: "Preview 150 by 150", exact: true }),
  ).toHaveCount(0);
  await page.locator("#browse-presets").click();
  await page.locator("#preset-search").fill("Profile image");
  await page
    .getByRole("button", { name: "Add Profile image", exact: true })
    .click();
  await expect(page.locator("#toast")).toHaveText(
    "Use up to 30 output sizes in one batch.",
  );
  await expect(
    page.getByRole("button", { name: "Add Profile image", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Remove 100 by 100", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add custom size", exact: true })
    .click();
  await expect(page.locator(".size-row")).toHaveCount(30);
  await expect(
    page.getByRole("button", { name: "Preview 150 by 150", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#toast")).toHaveText("150 × 150 added.");
  await expect(page.locator("#res-width")).toHaveValue("");
});

test("keyboard focus survives preset toggles, size selection, and image list rerenders", async ({
  page,
}) => {
  await page.locator("#browse-presets").press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Find your perfect size.", exact: true }),
  ).toBeVisible();
  const webCategory = page
    .locator("#preset-categories")
    .getByRole("button", { name: "Web", exact: true });
  await webCategory.press("Enter");
  await expect(webCategory).toBeFocused();
  await expect(webCategory).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Add Profile image", exact: true })
    .press("Enter");
  const removePreset = page.getByRole("button", {
    name: "Remove Profile image",
    exact: true,
  });
  await expect(removePreset).toBeFocused();
  await removePreset.press("Space");
  await expect(
    page.getByRole("button", { name: "Add Profile image", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#browse-presets")).toBeFocused();
  const landscape = page.getByRole("button", {
    name: "Preview 1920 by 1080",
    exact: true,
  });
  await landscape.press("Enter");
  await expect(landscape).toBeFocused();
  await expect(landscape).toHaveAttribute("aria-pressed", "true");
  await upload(page, [
    await imageFile("first.png"),
    await imageFile("second.png", "png", "#2563eb"),
  ]);
  const second = page.getByRole("button", {
    name: "Select second.png",
    exact: true,
  });
  await second.press("Enter");
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Remove second.png", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("button", { name: "Select first.png", exact: true }),
  ).toBeFocused();
  await expect(page.locator("#image-count")).toHaveText("1");
});

test("a failed new preview clears the previous image and retry restores the selected image", async ({
  page,
}) => {
  await upload(page, [await imageFile("first.png")]);
  await expect(page.locator("#output-preview-card")).toBeVisible();
  const oldPreview = await page
    .locator("#output-preview-image")
    .getAttribute("src");
  await page.evaluate(() => {
    const firstId = window.__imageRescaler.getState().selectedImageId;
    window.__originalPreview = window.api.getImagePreview;
    window.api.getImagePreview = (id) =>
      id === firstId
        ? window.__originalPreview(id)
        : Promise.reject(new Error("Temporary preview decoding failure."));
  });
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("#add-images").click();
  await (
    await chooserPromise
  ).setFiles([await imageFile("retry-me.png", "png", "#2563eb")]);
  await expect(page.locator("#image-list > li")).toHaveCount(2);
  await expect(page.locator("#workspace")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page
    .getByRole("button", { name: "Select retry-me.png", exact: true })
    .click();
  await expect(page.locator("#preview-error")).toBeVisible();
  await expect(page.locator("#preview-error-message")).toHaveText(
    "Temporary preview decoding failure.",
  );
  await expect(page.locator("#output-preview-card")).not.toBeVisible();
  await expect(page.locator("#crop-viewport")).not.toBeVisible();
  expect(
    await page.locator("#output-preview-image").getAttribute("src"),
  ).toBeNull();
  expect(await page.locator("#crop-image").getAttribute("src")).toBeNull();
  await expect(page.locator("#zoom-in")).toBeDisabled();
  await expect(page.locator("#zoom-range")).toBeDisabled();
  await expect(page.locator("#reset-crop")).toBeDisabled();
  await page.evaluate(() => {
    window.api.getImagePreview = window.__originalPreview;
    delete window.__originalPreview;
  });
  await page.locator("#retry-preview").click();
  await expect(page.locator("#preview-error")).not.toBeVisible();
  await expect(page.locator("#output-preview-card")).toBeVisible();
  await expect(page.locator("#output-preview-image")).toHaveAttribute(
    "src",
    /^data:image\/png/,
  );
  expect(
    await page.locator("#output-preview-image").getAttribute("src"),
  ).not.toBe(oldPreview);
  await expect(page.locator("#image-detail")).toContainText("retry-me.png");
  await expect(page.locator("#zoom-in")).toBeEnabled();
  await expect(page.locator("#reset-crop")).toBeEnabled();
});

test("CMYK Photoshop files open in the crop workspace and export", async ({
  page,
}) => {
  await expect(page.locator(".file-types")).toContainText("PSD");
  const original = cmykPsdFile();
  await upload(page, [original]);
  await expect(page.locator("#image-list strong")).toHaveText("mosque.psd");
  await expect(page.locator("#image-list small")).toContainText("192 × 128");
  await expect(page.locator("#crop-image")).toHaveAttribute(
    "src",
    /^data:image\/png/,
  );
  await expect(page.locator("#crop-viewport")).toBeVisible();
  await page.locator("#crop-viewport").focus();
  await page.keyboard.press("ArrowRight");
  await page.locator('[data-format="png"]').click();
  const files = await exportArchive(page);
  const outputs = files.filter((file) => !file.name.includes("/originals/"));
  expect(outputs.map((file) => file.name.split("/").pop()).sort()).toEqual([
    "mosque_1080x1080.png",
    "mosque_1080x1920.png",
    "mosque_1920x1080.png",
  ]);
  for (const file of outputs) {
    const exported = await sharp(await file.async("nodebuffer")).metadata();
    expect(exported.format).toBe("png");
    expect(exported.width).toBeGreaterThan(0);
    expect(exported.height).toBeGreaterThan(0);
  }
});
