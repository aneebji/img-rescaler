# Changelog

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
