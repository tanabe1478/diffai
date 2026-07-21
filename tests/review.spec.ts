import { expect, test } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";

test("固定fixtureの未コミットdiffをスクロールし、変更行へコメントできる", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header .workspace")).toContainText(/tests[\\/]\.tmp[\\/]workspace/);
  await expect(page.locator(".waiting-banner")).toContainText("Piがレビュー完了を待っています");

  await page.locator(".target select").selectOption("uncommitted");
  await expect(page.locator(".tree-file")).toHaveCount(2);
  await page.locator(".tree-dir").filter({ hasText: "src" }).click();
  await expect(page.locator(".tree-file")).toHaveCount(1);
  await page.locator(".tree-dir").filter({ hasText: "src" }).click();
  await expect(page.locator(".tree-file")).toHaveCount(2);
  await page.locator(".tree-file").filter({ hasText: "long-file.ts" }).click();

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
  await page.locator(".tree-file").filter({ hasText: "long-file.ts" }).click();
  await expect(page.locator(".line-comment")).toContainText("Playwrightからの行コメント");
  await expect(page.locator("#feedback")).toHaveValue("ファイル全体へのフィードバック");

  await page.locator(".line-comment > button").click();
  await expect(page.locator(".line-comment")).toHaveCount(0);
  await page.reload();
  await page.locator(".target select").selectOption("uncommitted");
  await page.locator(".tree-file").filter({ hasText: "long-file.ts" }).click();
  await expect(page.locator(".line-comment")).toHaveCount(0);
});

test("コメント一覧と修正依頼を利用できる", async ({ page }) => {
  await page.goto("/");
  await page.locator(".target select").selectOption("uncommitted");
  await page.locator(".tree-file").filter({ hasText: "long-file.ts" }).click();
  await page.locator("#feedback").fill("まとめて修正するコメント");
  await expect(page.locator(".review-summary")).toContainText("レビューコメント一覧 (1)");
  await page.locator(".review-summary summary").click();
  await expect(page.getByRole("button", { name: "まとめてPiへ修正依頼" })).toBeVisible();

  await page.getByRole("button", { name: "修正を依頼" }).click();
  await expect(page.locator(".title em")).toContainText("rejected");
  await page.reload();
  await page.locator(".target select").selectOption("uncommitted");
  await page.locator(".tree-file").filter({ hasText: "long-file.ts" }).click();
  await expect(page.locator(".title em")).toContainText("rejected");
});

test("固定fixtureの最新・特定コミットとブランチ間を比較できる", async ({ page }) => {
  await page.goto("/");
  await page.locator(".target select").selectOption("latest");
  await expect(page.locator(".tree-file").filter({ hasText: "long-file.ts" })).toBeVisible();

  const option = page.locator(".target select optgroup option").first();
  await expect(option).toContainText("Initial fixture commit");
  const hash = await option.getAttribute("value");
  await page.locator(".target select").selectOption(hash!);
  await expect(page.locator(".tree-file").filter({ hasText: "long-file.ts" })).toBeVisible();

  await page.locator(".target select").selectOption("compare");
  await page.getByLabel("比較元").fill("master");
  await page.getByLabel("比較先").fill("feature");
  await page.locator(".compare button").click();
  await expect(page.locator(".tree-file").filter({ hasText: "feature.ts" })).toBeVisible();

  await page.getByLabel("比較元").fill("存在しないref");
  await page.locator(".compare button").click();
  await expect(page.locator(".error")).toBeVisible();
});

test("狭い画面でもファイル一覧とdiffを操作できる", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/");
  await page.locator(".target select").selectOption("uncommitted");
  await page.locator(".tree-file").filter({ hasText: "long-file.ts" }).click();
  await expect(page.locator(".chat")).toBeHidden();
  await expect(page.locator(".diff")).toBeVisible();
  await expect(page.locator(".diff-row.changed").first()).toBeVisible();
});

test("バイナリファイルは文字化けせずプレースホルダ表示される", async ({ page }) => {
  const binaryPath = path.resolve("tests/.tmp/workspace/asset.bin");
  await fs.writeFile(binaryPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0xff, 0x00, 0xfe]));
  try {
    await page.goto("/");
    await page.locator(".target select").selectOption("uncommitted");
    await page.locator(".tree-file").filter({ hasText: "asset.bin" }).click();
    await expect(page.locator(".diff")).toContainText("Binary file (10 bytes, sha256");
  } finally {
    await fs.rm(binaryPath);
  }
});

test("未確認ファイルを一括Approveしてレビュー完了を通知できる", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "レビューを完了" })).toBeEnabled();
  await page.getByRole("button", { name: "レビューを完了" }).click();
  await expect(page.locator(".completion-overlay")).toContainText("レビュー結果をPiへ送信中");
  await expect(page.locator(".completion-overlay")).toContainText("Piへレビュー結果を送信しました");
  await expect(page.locator("header .status")).toContainText("completed: approved");
});
