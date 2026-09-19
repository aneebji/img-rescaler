import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ reducedMotion: "reduce" });
async function checkAccessibility(page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}
test("empty, populated, and dark workspaces pass automated accessibility checks", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#preview-res-tabs > button")).toHaveCount(3);
  await page.waitForLoadState("networkidle");
  await checkAccessibility(page);
  await page.locator("#load-demo").click();
  await expect(page.locator("#rescale")).toBeEnabled();
  await checkAccessibility(page);
  await page.locator("#theme-toggle").click();
  await checkAccessibility(page);
});
test("presets and guide dialogs have accessible controls and contrast", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#preview-res-tabs > button")).toHaveCount(3);
  await page.waitForLoadState("networkidle");
  await page.locator("#browse-presets").click();
  await checkAccessibility(page);
  await page.keyboard.press("Escape");
  await page.locator("#help-button").click();
  await checkAccessibility(page);
});
