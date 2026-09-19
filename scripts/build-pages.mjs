import { cp, rm, writeFile } from "node:fs/promises";
await rm(new URL("../docs/", import.meta.url), {
  recursive: true,
  force: true,
});
await cp(
  new URL("../dist-renderer/", import.meta.url),
  new URL("../docs/", import.meta.url),
  { recursive: true },
);
await writeFile(new URL("../docs/.nojekyll", import.meta.url), "");
console.log("GitHub Pages build ready in docs/");
