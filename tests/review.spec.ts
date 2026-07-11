import { expect, test } from "@playwright/test";

test("固定fixtureの未コミットdiffをスクロールし、変更行へコメントできる", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header .workspace")).toContainText("tests\\.tmp\\workspace");

  await page.locator(".target select").selectOption("uncommitted");
  await expect(page.locator("aside > button")).toHaveCount(2);
  await page.locator("aside > button").filter({ hasText: "long-file.ts" }).click();

  const diff = page.locator(".diff");
  const metrics = await diff.evaluate(element => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
  expect(metrics.clientHeight).toBeGreaterThan(0);
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

  await diff.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => diff.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(diff.locator(".diff-row").last()).toBeInViewport();
  await diff.evaluate(element => { element.scrollTop = 0; });

  const changedRow = page.locator(".diff-row.changed").first();
  await changedRow.hover();
  await changedRow.locator(".num button").last().click();
  await page.locator(".comment-editor textarea").fill("Playwrightからの行コメント");
  await page.locator(".comment-editor button").filter({ hasText: "追加" }).click();
  await expect(page.locator(".line-comment")).toContainText("Playwrightからの行コメント");
  await page.locator("#feedback").fill("ファイル全体へのフィードバック");

  await page.reload();
  await page.locator(".target select").selectOption("uncommitted");
  await page.locator("aside > button").filter({ hasText: "long-file.ts" }).click();
  await expect(page.locator(".line-comment")).toContainText("Playwrightからの行コメント");
  await expect(page.locator("#feedback")).toHaveValue("ファイル全体へのフィードバック");

  await page.locator(".line-comment > button").click();
  await expect(page.locator(".line-comment")).toHaveCount(0);
  await page.reload();
  await page.locator(".target select").selectOption("uncommitted");
  await page.locator("aside > button").filter({ hasText: "long-file.ts" }).click();
  await expect(page.locator(".line-comment")).toHaveCount(0);
});

test("固定fixtureの最新コミットと特定コミットを選択できる", async ({ page }) => {
  await page.goto("/");
  await page.locator(".target select").selectOption("latest");
  await expect(page.locator("aside > button").filter({ hasText: "long-file.ts" })).toBeVisible();

  const option = page.locator(".target select optgroup option").first();
  await expect(option).toContainText("Initial fixture commit");
  const hash = await option.getAttribute("value");
  await page.locator(".target select").selectOption(hash!);
  await expect(page.locator("aside > button").filter({ hasText: "long-file.ts" })).toBeVisible();
});
