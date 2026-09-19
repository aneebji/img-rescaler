import { chromium } from "playwright";
import { readFile, mkdir } from "node:fs/promises";

// Start npm run dev:web before running this optional documentation helper.
const browser = await chromium.launch();
try {
  await mkdir("media", { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5173");
  await page.locator("#load-demo").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#crop-image").naturalWidth > 0 &&
      !document.querySelector("#rescale").disabled,
  );
  await page.screenshot({ path: "media/workspace.png", fullPage: true });
  await page.locator("#theme-toggle").click();
  await page.screenshot({ path: "media/workspace-dark.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#theme-toggle").click();
  await page.screenshot({ path: "media/workspace-mobile.png", fullPage: true });
  const sample = (await readFile("src/public/sample.svg")).toString("base64");
  const logo = await readFile("src/public/favicon.svg", "utf8");
  const card = await context.newPage();
  await card.setViewportSize({ width: 1200, height: 630 });
  await card.setContent(`<!doctype html><html><head><style>
    *{box-sizing:border-box}body{margin:0;background:#f6f7f4;color:#26352b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.card{height:630px;width:1200px;padding:58px 64px;position:relative;overflow:hidden}.brand{display:flex;align-items:center;gap:12px;font-size:25px;letter-spacing:-1px;font-weight:650}.brand svg{width:43px;height:43px}.brand span{font-weight:400}.eyebrow{font-size:12px;letter-spacing:2.2px;font-weight:600;color:#3e583b;margin-top:67px}h1{font-size:68px;letter-spacing:-3px;line-height:1.14;margin:19px 0 23px;font-weight:650}h1 em{font-family:Georgia,serif;font-weight:400;color:#3e583b}p{font-size:18px;line-height:1.8;color:#626d5e;margin:0;max-width:530px}.pills{display:flex;gap:9px;margin-top:26px}.pills span{border:1px solid #cfd8c9;border-radius:5px;padding:8px 13px;font-size:12px;font-weight:600;color:#3e583b}.art{position:absolute;right:-37px;top:91px;width:420px;height:505px;background:#fff;border-radius:17px;padding:13px;transform:rotate(7deg);box-shadow:0 18px 70px #27382318;border:1px solid #e5e8e0}.art img{width:100%;height:100%;object-fit:cover;border-radius:8px}.frame{position:absolute;inset:47px 40px;border:2px solid white;box-shadow:0 0 0 26px #12201525;border-radius:2px}.line{position:absolute;background:#ffffff80}.line.v{width:1px;top:0;bottom:0;left:33%}.line.v.two{left:66%}.line.h{height:1px;left:0;right:0;top:33%}.line.h.two{top:66%}.tag{position:absolute;bottom:36px;left:60px;padding:10px 16px;background:#344b37;color:white;border-radius:6px;font-size:13px;letter-spacing:.6px}.footer{font-size:12px;color:#626d5e;margin-top:45px}
  </style></head><body><div class="card"><div class="brand">${logo}<div>image<span>rescaler</span></div></div><div class="eyebrow">YOUR PRIVATE IMAGE WORKSPACE</div><h1>Every image.<br><em>A perfect fit.</em></h1><p>Precise crops. Every size. One effortless export.<br>Free, open source, and entirely on your device.</p><div class="pills"><span>PNG</span><span>JPEG</span><span>WebP</span><span>Batch export</span></div><div class="footer">aneebji.github.io/img-rescaler</div><div class="art"><img src="data:image/svg+xml;base64,${sample}"/><div class="frame"><i class="line v"></i><i class="line v two"></i><i class="line h"></i><i class="line h two"></i></div><div class="tag">COMPOSE. RESIZE. CREATE.</div></div></div></body></html>`);
  await card.locator("img").evaluate((image) => image.decode());
  await card.screenshot({ path: "src/public/social-card.png" });
  console.log("Workspace screenshots and social preview generated.");
} finally {
  await browser.close();
}
