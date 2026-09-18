# Image Rescaler

**Exact-size PNG exports. One crop per resolution. No stretch.**

A desktop and web app for production image batches — product shots, print layouts, and profile frames — where every output must match a target size and a chosen composition.

[![Website](https://img.shields.io/badge/web_app-aneebji.github.io-0A84FF?logo=github)](https://aneebji.github.io/img-rescaler/)
[![macOS](https://img.shields.io/badge/macOS-supported-111111?logo=apple&logoColor=white)](https://github.com/aneebji/img-rescaler)
[![Electron](https://img.shields.io/badge/Electron-36-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Sharp](https://img.shields.io/badge/Sharp-0.34-99CC00?logo=imagemagick&logoColor=white)](https://sharp.pixelplumbing.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-0A84FF.svg)](./LICENSE)

**Web app (crop + ZIP):** [aneebji.github.io/img-rescaler](https://aneebji.github.io/img-rescaler/)  
**Clone:** `git clone https://github.com/aneebji/img-rescaler.git`

---

## Why this exists

Generic resizers either pad empty bars or squash the photo. Image Rescaler shows the full photo with a crop frame for each target aspect ratio. You pan or zoom until the frame is right. Every image × size keeps its own crop. Export is always PNG at the exact pixel dimensions you asked for.

## Capabilities

- **Full-photo crop editor** — the whole image stays visible; the box matches each size
- **Independent frames** — switch resolutions and keep a separate composition for each size
- **Web ZIP download** — Rescale saves `originals/` plus `{name}_{width}x{height}.png` in one dated ZIP
- **Desktop run folders** — same originals + PNGs in `output/YYYY-MM-DD_HH-mm-ss/`
- **Broad ingest** — JPG, PNG, WebP, GIF, BMP, and more (HEIC/TIFF need the desktop app)
- **Batch jobs** — one run, every selected image × every size

## Default sizes

These presets load on launch and can be removed or extended:

| Width | Height | Aspect |
| ---: | ---: | --- |
| 680 | 1000 | Portrait |
| 1020 | 1000 | Near-square |
| 1119 | 1527 | Tall portrait |
| 1119 | 648 | Wide landscape |

Newly added sizes move to the front and stay selected so the last one you defined is the one you preview.

## Workflow

1. Drop images or use **Add images**.
2. Keep the defaults, or add more `width × height` targets.
3. Select a photo and a size. Drag the box and scroll to zoom.
4. Click **Rescale**.
   - **Web:** a ZIP downloads with `originals/` and every PNG.
   - **Desktop:** a dated folder is created with the same layout.

## Quick start

**Use it in the browser:** [aneebji.github.io/img-rescaler](https://aneebji.github.io/img-rescaler/)

**Desktop (Node.js 18+, macOS):**

```bash
git clone https://github.com/aneebji/img-rescaler.git
cd img-rescaler
npm install
npm run dev
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Local Electron app |
| `npm run build` | Renderer bundle |
| `npm run build:pages` | Copy the web app into `docs/` for GitHub Pages |
| `npm run package:mac` | Unsigned `.dmg` / `.zip` via electron-builder |

## Architecture

| Layer | Role |
| --- | --- |
| **Web** | File API, canvas crop, JSZip download |
| **Electron** | File dialogs, Sharp encode, Finder reveal |
| **Vite renderer** | Crop UI, per-image / per-size state |

```
src/                 UI + browser I/O
electron/            Desktop main process + preload
output/              Dated export folders (gitignored)
release/             Packaged Mac artifacts (gitignored)
```

## Output contract

- Container: **PNG**
- Geometry: exact target width × height
- Naming: `{basename}_{width}x{height}.png`
- Originals: `originals/<filename>` in the same ZIP / run folder
- Isolation: one dated ZIP or folder per Rescale run

## License

[MIT](./LICENSE) © 2026 Aneeb
