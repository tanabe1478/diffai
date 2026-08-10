import { expect, test } from "@playwright/test";

// コミットが1つもないリポジトリ(unborn branch)でも未コミット変更をレビューできる
test("コミットゼロのリポジトリで未コミット変更が初期表示される", async ({ page }) => {
  await page.goto("http://127.0.0.1:4322/");
  await expect(page.locator("header .workspace")).toContainText("tests/.tmp-unborn/workspace");

  // ステージ済み + 未追跡の両方が「未コミットの変更」として並ぶ
  await expect(page.locator(".tree-file")).toHaveCount(2);
  await expect(page.locator(".tree-file").filter({ hasText: "staged.ts" })).toBeVisible();
  await expect(page.locator(".tree-file").filter({ hasText: "untracked.ts" })).toBeVisible();

  // 全文が追加行として描画される(before は空)
  await page.locator(".tree-file").filter({ hasText: "untracked.ts" }).click();
  await expect(
    page.locator('.diffai-file-diff [data-line-type="change-addition"]').first(),
  ).toBeVisible();
});
