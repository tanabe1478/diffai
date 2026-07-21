import { expect, test } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";

test("固定fixtureの未コミットdiffをスクロールし、変更行へコメントできる", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header .workspace")).toContainText("tests/.tmp/workspace");
  await expect(page.locator(".waiting-banner")).toContainText("レビュー完了待ちです");
  await expect(page.locator("body")).not.toContainText("Piへ");
  await expect(page.locator(".chat")).toHaveCount(0);

  await page.locator(".target select").selectOption("uncommitted");
  await expect(page.locator(".tree-file")).toHaveCount(6);
  const srcDir = page.locator(".tree-dir").filter({ hasText: "src" });
  await expect(srcDir).toHaveAttribute("aria-expanded", "true");
  await srcDir.click();
  await expect(srcDir).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".tree-file")).toHaveCount(5);
  await srcDir.click();
  await expect(srcDir).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".tree-file")).toHaveCount(6);
  await page.locator(".tree-file").filter({ hasText: "long-file.ts" }).click();
  await expect(page.locator(".feedback-box .reply")).toContainText("値の変更を確認しました");

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
  await expect(page.locator(".line-comment code")).toContainText("export const value20 = 2000;");
  await expect(page.locator(".line-comment")).not.toContainText("outdated");
  await page.locator("#feedback").fill("ファイル全体へのフィードバック");

  await page.reload();
  await page.locator(".target select").selectOption("uncommitted");
  await page.locator(".tree-file").filter({ hasText: "long-file.ts" }).click();
  await expect(page.locator(".line-comment")).toContainText("Playwrightからの行コメント");
  await expect(page.locator("#feedback")).toHaveValue("ファイル全体へのフィードバック");
  const cwd = (await page.locator("header .workspace").textContent())!;
  await page.evaluate(({ prefix }) => {
    const key = Object.keys(localStorage).find(item => item.startsWith(prefix));
    if (!key) throw new Error("review storage key not found");
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    saved.comments[0].quote = "export const stale = true;";
    localStorage.setItem(key, JSON.stringify(saved));
  }, { prefix: `diffai:review:${cwd}:` });
  await page.reload();
  await page.locator(".target select").selectOption("uncommitted");
  await page.locator(".tree-file").filter({ hasText: "long-file.ts" }).click();
  await expect(page.locator(".line-comment")).toContainText("outdated");
  await expect(page.locator(".line-comment code")).toContainText("export const stale = true;");

  await page.locator(".line-comment > button").click();
  await expect(page.locator(".line-comment")).toHaveCount(0);
  await page.reload();
  await page.locator(".target select").selectOption("uncommitted");
  await page.locator(".tree-file").filter({ hasText: "long-file.ts" }).click();
  await expect(page.locator(".line-comment")).toHaveCount(0);
});

test("保存済みapprovedは復元せず修正依頼できる", async ({ page }) => {
  await page.goto("/");
  const cwd = (await page.locator("header .workspace").textContent())!;
  const currentDiff = await page.locator(".tree-file").filter({ hasText: "long-file.ts" }).textContent();
  await page.evaluate(({ prefix }) => {
    const key = Object.keys(localStorage).find(item => item.startsWith(prefix));
    if (!key) throw new Error("review storage key not found");
    localStorage.setItem(key, JSON.stringify({ comments: [], feedback: {}, statuses: {
      "review:uncommitted::src/long-file.ts": { status: "approved", before: "ignored", after: "ignored" },
    } }));
  }, { prefix: `diffai:review:${cwd}:` });
  expect(currentDiff).toContain("long-file.ts");
  await page.reload();
  await page.locator(".target select").selectOption("uncommitted");
  await page.locator(".tree-file").filter({ hasText: "long-file.ts" }).click();
  await expect(page.locator(".title em")).toContainText("pending");
  await expect(page.getByRole("button", { name: "修正を依頼" })).toBeEnabled();
});

test("コメント一覧と修正依頼を利用できる", async ({ page }) => {
  await page.goto("/");
  await page.locator(".target select").selectOption("uncommitted");
  await page.locator(".tree-file").filter({ hasText: "long-file.ts" }).click();
  await page.locator("#feedback").fill("まとめて修正するコメント");
  await expect(page.locator(".review-summary")).toContainText("レビューコメント一覧 (1)");
  await page.locator(".review-summary summary").click();
  await expect(page.getByRole("button", { name: "レビュー完了時に返す" })).toBeVisible();

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
  await expect(page.locator(".chat")).toHaveCount(0);
  await expect(page.locator(".diff")).toBeVisible();
  await expect(page.locator(".diff-row.changed").first()).toBeVisible();
});

test("GitHub互換grammarで複数言語の構文をハイライトする", async ({ page }) => {
  await page.goto("/");
  await page.locator(".target select").selectOption("uncommitted");
  await expect(page.locator("header .status")).toContainText("review: 未コミットの変更");
  await expect(page.locator(".tree-file")).toHaveCount(6);

  const cases = [
    { file: "StudyDict.tla", selector: ".pl-k", token: "CONSTANTS" },
    { file: "long-file.ts", selector: ".pl-k", token: "export" },
    { file: "README.md", selector: ".pl-mh", token: "Highlight fixture" },
    { file: "config.json", selector: ".pl-ent", token: '"enabled"' },
    { file: "Example.swift", selector: ".pl-k", token: "struct" },
  ];
  for (const item of cases) {
    await page.locator(".tree-file").filter({ hasText: item.file }).click();
    await expect(page.locator(".title h2")).toContainText(item.file);
    await expect(page.locator(`.diff ${item.selector}`).filter({ hasText: item.token }).first()).toBeVisible();
  }
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

test("同じブラウザで完了後の返信確認と再レビューができる", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "レビューを完了" })).toBeEnabled();
  await page.getByRole("button", { name: "レビューを完了" }).click();
  await expect(page.locator(".completion-overlay")).toContainText("レビュー結果を送信中");
  await expect(page.locator(".completion-overlay")).toContainText("このタブのままお待ちください");
  await expect(page.locator(".completion-overlay")).not.toContainText("Pi");
  await expect(page.locator("header .status")).toContainText("completed: approved");

  const repliesPath = path.resolve("tests/.tmp/workspace/.diffai/review-replies.json");
  await fs.writeFile(repliesPath, JSON.stringify({ replies: [{
    commentId: "feedback:review:uncommitted::src/long-file.ts",
    status: "fixed",
    body: "再レビュー用の修正返信",
  }] }));
  const reload = await request.post("/api/reload");
  expect(reload.ok()).toBeTruthy();

  await expect(page.locator(".completion-overlay")).toHaveCount(0);
  await page.locator(".tree-file").filter({ hasText: "long-file.ts" }).click();
  await expect(page.locator(".feedback-box .reply")).toContainText("再レビュー用の修正返信");
  await page.getByRole("button", { name: "レビューを完了" }).click();
  await expect(page.locator(".completion-overlay")).toContainText("このタブのままお待ちください");
  await expect.poll(async () => (await (await request.get("/api/state")).json()).resultCount).toBe(2);
});
