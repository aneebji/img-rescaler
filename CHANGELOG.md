# Changelog

## 3.1.1 — 2026-09-22

### macOS signing

- Ad-hoc signed the macOS app so Gatekeeper no longer treats the download as damaged and asks to move it to the Bin.

## 3.1.0 — 2026-09-22

### Desktop downloads

- Added unsigned macOS (Apple Silicon) and Windows packages, published on each GitHub release.
- The live workspace stays at the same GitHub Pages URL and is rebuilt from `docs/` when `main` is updated.

### Exports

- Added a 2 MB export preset that keeps each output file under 2 MB, with a switch to keep the original file size instead.

### Discovery

- Clarified public search metadata, structured data, and crawler files so Image Rescaler is easier to find as a free image resizer.

## 3.0.0 — 2026-09-19

### Photoshop files in the crop workspace

- Added Photoshop PSD and PSB composite decode so CMYK and RGB files can be cropped and exported in the browser and desktop apps.
- Documented PSD/PSB as a supported source format alongside PNG, JPEG, and WebP exports.

## 2.0.0 — 2026-09-19

### A new image workspace

- Redesigned the editor with a focused crop studio, image library, live final preview, and guided export settings.
- Added light and dark themes, responsive mobile layouts, an original sample illustration, and an in-app guide.
- Added 16 size presets across Social, Commerce, Web, and the original size collection, plus custom dimensions.
- Added remembered output preferences, keyboard crop controls, touch dragging, visible zoom controls, and composition-grid toggling.

### More control over delivery

- Added PNG, JPEG, and WebP exports in both browser and desktop apps.
- Added adjustable JPEG/WebP quality and optional source originals.
- Added exact output dimensions, file-size summaries, upscale notices, and progress through ZIP preparation.
- Preserved individual crop compositions for each image and output size.

### Reliability and accessibility

- Prevented files with matching basenames from overwriting each other.
- Fixed EXIF-rotated desktop image dimensions and transparent browser previews.
- Added dimension limits, safer filenames, crop bounds, import errors, and preview retry handling.
- Locked export settings during processing and prevented older asynchronous previews from replacing the current selection.
- Added named dialogs, keyboard focus retention, live status announcements, and improved contrast.
- Enabled Electron sandboxing and restricted navigation and external links.
- Updated application dependencies and added regression tests for real browser/desktop exports and automated accessibility checks.

### Public project

- Added product screenshots, a social sharing image, a desktop icon, expanded documentation, contribution guidance, issue forms, and a ready-to-enable CI workflow.
- Retained the original GitHub Pages URL: <https://aneebji.github.io/img-rescaler/>.

## 1.0.0

Initial browser and desktop app with PNG batch exports, separate crops for each resolution, original-file preservation, and GitHub Pages hosting.
