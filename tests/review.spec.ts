import { expect, test } from "@playwright/test";
import { promises as fs } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

type CliReviewResult = {
  decision: "approved" | "changes_requested";
  fileFeedback: Array<{ id: string; path: string; body: string }>;
};

function startReviewWaiter() {
  const workspace = path.resolve("tests/.tmp/workspace");
  const child = spawn(process.execPath, ["dist/server/index.js", "--cwd", workspace, "--no-open"], {
    cwd: path.resolve("."),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const collect = (chunk: Buffer) => {
    output += chunk.toString();
    if (output.includes("同じブラウザで再レビュー待ち")) readyResolve();
  };
  child.stdout!.on("data", collect);
  child.stderr!.on("data", collect);
  const result = new Promise<CliReviewResult>((resolve, reject) => child.on("exit", code => {
    const line = output.split("\n").find(item => item.startsWith("DIFFAI_REVIEW_RESULT="));
    if (code === 0 && line) resolve(JSON.parse(line.slice("DIFFAI_REVIEW_RESULT=".length)) as CliReviewResult);
    else {
      const error = new Error(`diffai waiter exited with ${code}: ${output}`);
      readyReject(error); reject(error);
    }
  }));
  return { child, ready, result };
}

function stopWaiter(child?: ChildProcess) {
  if (child && child.exitCode === null) child.kill("SIGTERM");
}

test("固定fixtureの未コミットdiffをスクロールし、変更行へコメントできる", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header .workspace")).toContainText("tests/.tmp/workspace");
  await expect(page.locator(".waiting-banner")).toContainText("レビュー完了待ちです");
  await expect(page.locator("body")).not.toContainText("Piへ");
  await expect(page.locator(".chat")).toHaveCount(0);

  await page.locator(".target select").selectOption("uncommitted");
  await expect(page.locator(".tree-file")).toHaveCount(7);
  const srcDir = page.locator(".tree-dir").filter({ hasText: "src" });
  await expect(srcDir).toHaveAttribute("aria-expanded", "true");
  await srcDir.click();
  await expect(srcDir).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".tree-file")).toHaveCount(6);
  await srcDir.click();
  await expect(srcDir).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".tree-file")).toHaveCount(7);
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
  await expect(page.locator(".tree-file")).toHaveCount(7);

  const cases = [
    { file: "StudyDict.tla", selector: ".pl-k", token: "CONSTANTS" },
    { file: "long-file.ts", selector: ".pl-k", token: "export" },
    { file: "README.md", selector: ".pl-mh", token: "Highlight fixture" },
    { file: "config.json", selector: ".pl-ent", token: '"enabled"' },
    { file: "Example.swift", selector: ".pl-k", token: "struct" },
    { file: "Example.tsx", selector: ".pl-ent", token: "main" },
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

test("指摘を受けたエージェントが修正し、同じブラウザで再レビューを完了できる", async ({ page }) => {
  let firstWaiter: ReturnType<typeof startReviewWaiter> | undefined;
  let secondWaiter: ReturnType<typeof startReviewWaiter> | undefined;
  try {
    await page.goto("/");

    // 1. 呼び出し元エージェントがdiffai CLIを起動し、ユーザーのレビューを待つ。
    firstWaiter = startReviewWaiter();
    await firstWaiter.ready;
    await expect(page.locator(".completion-overlay")).toHaveCount(0);
    await page.locator(".tree-file").filter({ hasText: "long-file.ts" }).click();

    // 2. ユーザーが問題を指摘して修正を依頼する。
    await page.locator("#feedback").fill("value20は2001にしてください");
    await page.getByRole("button", { name: "修正を依頼" }).click();
    await expect(page.locator(".title em")).toContainText("rejected");
    await page.getByRole("button", { name: "レビューを完了" }).click();
    await expect(page.locator(".completion-overlay")).toContainText("修正依頼を呼び出し元へ送信しました");
    await expect(page.locator(".completion-overlay")).toContainText("修正後にdiffaiを再実行すると、再レビュー画面へ切り替わります");

    // 3. CLIがchanges_requestedと返信先IDを呼び出し元へ返す。
    const firstResult = await firstWaiter.result;
    expect(firstResult.decision).toBe("changes_requested");
    const requestedChange = firstResult.fileFeedback.find(item => item.path === "src/long-file.ts");
    expect(requestedChange?.body).toBe("value20は2001にしてください");

    // 4. エージェントが指摘を反映し、コメントへの返信を書く。
    const workspace = path.resolve("tests/.tmp/workspace");
    const sourcePath = path.join(workspace, "src/long-file.ts");
    const source = await fs.readFile(sourcePath, "utf8");
    await fs.writeFile(sourcePath, source.replace("value20 = 2000", "value20 = 2001"));
    await fs.writeFile(path.join(workspace, ".diffai/review-replies.json"), JSON.stringify({ replies: [{
      commentId: requestedChange!.id,
      status: "fixed",
      body: "value20を2001へ修正しました",
    }] }));

    // 5. エージェントが同じCLIを再実行する。同じタブへ修正差分と返信が届く。
    secondWaiter = startReviewWaiter();
    await secondWaiter.ready;
    await expect(page.locator(".completion-overlay")).toHaveCount(0);
    await page.locator(".tree-file").filter({ hasText: "long-file.ts" }).click();
    await expect(page.locator(".feedback-box .reply")).toContainText("value20を2001へ修正しました");
    await expect(page.locator(".diff")).toContainText("value20 = 2001");
    await expect(page.locator(".title em")).toContainText("pending");

    // 6. ユーザーが再レビューを承認し、2回目のCLIがapprovedを受け取る。
    await page.getByRole("button", { name: "レビューを完了" }).click();
    await expect(page.locator(".completion-overlay")).toContainText("レビューが完了しました");
    await expect(page.locator(".completion-overlay")).toContainText("このタブは閉じて構いません");
    const secondResult = await secondWaiter.result;
    expect(secondResult.decision).toBe("approved");
  } finally {
    stopWaiter(firstWaiter?.child);
    stopWaiter(secondWaiter?.child);
  }
});
