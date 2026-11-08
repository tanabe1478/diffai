import { expect, test } from "@playwright/test";

// ディレクトリへのシンボリックリンクがあっても、他の変更ごと空にならない
test("シンボリックリンクはリンク先のパスとして表示され、他の変更も表示される", async ({ page }) => {
  await page.goto("http://127.0.0.1:4323/");
  await expect(page.locator("header .workspace")).toContainText("tests/.tmp-symlink/workspace");

  await expect(page.locator(".tree-file")).toHaveCount(3);
  await expect(page.locator(".tree-file").filter({ hasText: "app.ts" })).toBeVisible();

  // Git と同じく、リンクの中身はリンク先のパス
  await page.locator(".tree-file").filter({ hasText: "guide" }).click();
  await expect(page.locator(".diffai-file-diff")).toContainText("../../skills/guide");
  await page.locator(".tree-file").filter({ hasText: "alias.ts" }).click();
  await expect(page.locator(".diffai-file-diff")).toContainText("app.ts");
});

// HEAD 側も末尾改行を保ったまま比較する(削ると変更前に "No newline at end of file" が誤って出る)
test("末尾改行のあるファイルの変更で、変更前に No newline at end of file が出ない", async ({ page }) => {
  await page.goto("http://127.0.0.1:4323/");
  await page.locator(".tree-file").filter({ hasText: "app.ts" }).first().click();
  const diff = page.locator(".diffai-file-diff");
  await expect(diff.locator('[data-line-type="change-addition"]').first()).toBeVisible();
  await expect(diff.getByText("No newline at end of file")).toHaveCount(0);
});
