import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";
import { buildDiffaiArgs, startDiffaiProcess, stopChildProcess, type DiffaiProcessOptions } from "../extensions/diffai/process.ts";
import { buildReviewResult, parseReviewResultLine, parseReviewResultOutput, serializeReviewResult } from "../protocol/index.ts";
import { foregroundGuard } from "../extensions/diffai/index.ts";
import { DIFFAI_REVIEW_STATE, readReviewState, SessionRouter, type ReviewState } from "../extensions/diffai/session-router.ts";
import { ReviewLoop } from "../extensions/diffai/review-loop.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

test("ReviewResult v1はbare JSON一行として厳格に解析される", () => {
  const result = buildReviewResult({
    decision: "changes_requested",
    reviewId: "r1",
    reviews: [{ id: "p1", path: "src/a.ts", status: "rejected" }],
    comments: [{ id: "c1", proposalId: "p1", side: "new", line: 1, body: "brace } and 日本語" }],
    fileFeedback: [],
    feedback: { p1: "修正してください" },
    replyFile: ".diffai/review-replies.json",
    replyFormat: { replies: [{ commentId: "<comment id or fileFeedback id>", status: "fixed|replied|wontfix", body: "<reply shown in diffai>" }] },
  });
  assert.equal(parseReviewResultLine(`${serializeReviewResult(result)}\r`).reviewId, "r1");
  assert.equal(parseReviewResultOutput(`${serializeReviewResult(result)}\r\n`).decision, "changes_requested");
  assert.throws(() => parseReviewResultOutput(`ログ\n${serializeReviewResult(result)}\n`));
  assert.throws(() => parseReviewResultOutput(`${serializeReviewResult(result)}\n${serializeReviewResult(result)}`));
  assert.throws(() => parseReviewResultLine(JSON.stringify({ ...result, schemaVersion: 2 })));
  assert.throws(() => parseReviewResultLine(JSON.stringify({ ...result, comments: [{ ...result.comments[0], unexpected: true }] })));
  const legacyRecord = ["DIFFAI", "REVIEW", "RESULT="].join("_") + serializeReviewResult(result);
  assert.throws(() => parseReviewResultLine(legacyRecord));
});

test("実processはstderrのURLだけを通知し、stdoutのbare v1 recordだけを受理する", async () => {
  const result = buildReviewResult({
    decision: "approved",
    reviewId: "process-review",
    reviews: [],
    comments: [],
    fileFeedback: [],
    feedback: {},
    replyFile: ".diffai/review-replies.json",
    replyFormat: { replies: [{ commentId: "<comment id or fileFeedback id>", status: "fixed|replied|wontfix", body: "<reply shown in diffai>" }] },
  });
  const serverEntry = path.resolve("tests/fixtures/stdio-child.mjs");
  const run = (mode: string) => new Promise<{ urls: string[]; results: unknown[]; errors: Error[]; exits: (number | null)[] }>(resolve => {
    const urls: string[] = [];
    const results: unknown[] = [];
    const errors: Error[] = [];
    const exits: (number | null)[] = [];
    const handle = startDiffaiProcess({
      serverEntry,
      cwd: process.cwd(),
      reviewId: result.reviewId,
      env: { ...process.env, DIFFAI_STDIO_MODE: mode, DIFFAI_RESULT: serializeReviewResult(result) },
      onUrl: url => urls.push(url),
      onResult: value => results.push(value),
      onError: error => errors.push(error),
      onExitWithoutResult: code => exits.push(code),
    });
    handle.closed.then(() => resolve({ urls, results, errors, exits }));
  });

  const valid = await run("valid");
  assert.deepEqual(valid.urls, ["http://127.0.0.1:4987"]);
  assert.deepEqual(valid.results, [result]);
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(valid.exits, []);

  const stdoutPolluted = await run("stdout-polluted");
  assert.deepEqual(stdoutPolluted.urls, []);
  assert.deepEqual(stdoutPolluted.results, []);
  assert.equal(stdoutPolluted.errors.length, 1);
  assert.deepEqual(stdoutPolluted.exits, []);
});

test("必須versionとtop-level fieldの欠落はfail closedになる", () => {
  const result = buildReviewResult({
    decision: "approved",
    reviewId: "required-fields",
    reviews: [],
    comments: [],
    fileFeedback: [],
    feedback: {},
    replyFile: ".diffai/review-replies.json",
    replyFormat: { replies: [] },
  });
  for (const field of ["schemaVersion", "decision", "reviewId", "reviews", "comments", "fileFeedback", "feedback", "replyFile", "replyFormat"]) {
    const missing = { ...result } as Record<string, unknown>;
    delete missing[field];
    assert.throws(() => parseReviewResultLine(JSON.stringify(missing)), field);
  }
});

test("CLIへreviewIdをPi非依存の引数として渡す", () => {
  assert.deepEqual(buildDiffaiArgs({ cwd: "/tmp/workspace", reviewId: "review-123" }), [
    "--cwd", "/tmp/workspace", "--review-id", "review-123",
  ]);
});

test("foreground guardはdiffaiだけをバックグラウンド実行から保護する", () => {
  assert.equal(foregroundGuard("diffai --cwd .", "/tmp/project"), undefined);
  assert.ok(foregroundGuard("diffai --cwd . > /tmp/review.log", "/tmp/project"));
  assert.ok(foregroundGuard("npx github:tanabe1478/diffai --cwd . &", "/tmp/project"));
  assert.equal(foregroundGuard("echo diffai > /tmp/log", "/tmp/project"), undefined);
});

test("session routerは現在branchの最新stateだけを読む", () => {
  const entry = (id: string, data: ReviewState) => ({ type: "custom" as const, customType: DIFFAI_REVIEW_STATE, id, parentId: null, timestamp: new Date().toISOString(), data });
  const state = readReviewState([
    entry("old", { version: 1, reviewId: "old", phase: "reviewing" }),
    entry("new", { version: 1, reviewId: "new", phase: "waiting_for_agent" }),
  ]);
  assert.equal(state?.reviewId, "new");
  assert.equal(readReviewState([]), undefined);
});

test("branch復元後に旧review processのcallbackが状態を書き換えない", async () => {
  const persisted: ReviewState[] = [];
  const notifications: string[] = [];
  const state = { version: 1 as const, reviewId: "review-123", phase: "reviewing" as const };
  const router = { persist: (value: ReviewState) => persisted.push(value), restore: () => state } as unknown as SessionRouter;
  const callbacks: DiffaiProcessOptions[] = [];
  let killCount = 0;
  let closeOld!: () => void;
  const oldClosed = new Promise<void>(resolve => { closeOld = resolve; });
  const loop = new ReviewLoop({
    pi: { sendUserMessage: () => undefined },
    router,
    serverEntry: "/tmp/diffai-server.js",
    notify: (_ctx, message) => notifications.push(message),
    startProcess: options => {
      callbacks.push(options);
      return { kill: () => { killCount++; }, closed: callbacks.length === 1 ? oldClosed : undefined };
    },
  });
  const context = (leafId: string) => ({
    cwd: "/tmp/project",
    isIdle: () => true,
    ui: { notify: () => undefined },
    sessionManager: { getSessionId: () => "session-1", getLeafId: () => leafId },
  }) as unknown as ExtensionContext;

  loop.start(context("branch-a"));
  const restoring = loop.restore(context("branch-b"), state);
  // close can be observed before the child invokes its callbacks. They must
  // already be fenced off, not merely ignored after restore finishes.
  callbacks[0].onExitWithoutResult(1);
  callbacks[0].onError(new Error("stale"));
  callbacks[0].onResult({ decision: "approved", reviewId: "review-123" });
  callbacks[0].onUrl?.("http://127.0.0.1:4317");
  closeOld();
  await restoring;

  assert.equal(killCount, 1);
  assert.equal(callbacks.length, 2);
  assert.equal(loop.phase, "reviewing");
  assert.equal(persisted.filter(value => value.phase === "ended").length, 0);
  assert.deepEqual(notifications, []);

  // A callback arriving after restore is fenced by the same run identity too.
  callbacks[0].onExitWithoutResult(1);
  assert.equal(loop.phase, "reviewing");
  assert.equal(persisted.filter(value => value.phase === "ended").length, 0);
});

test("cancelはcallbackを先に無効化し、endedを保存してから停止する", async () => {
  const persisted: ReviewState[] = [];
  const router = { persist: (state: ReviewState) => persisted.push(state), restore: () => undefined } as unknown as SessionRouter;
  let options!: DiffaiProcessOptions;
  let endedBeforeStop = false;
  const statuses: string[] = [];
  const loop = new ReviewLoop({
    pi: { sendUserMessage: () => undefined },
    router,
    serverEntry: "/tmp/diffai-server.js",
    notify: () => undefined,
    onStateChange: status => statuses.push(status.phase),
    startProcess: value => {
      options = value;
      return {
        stop: async () => {
          endedBeforeStop = persisted.at(-1)?.phase === "ended";
          options.onExitWithoutResult(143);
        },
      };
    },
  });
  const ctx = { cwd: "/tmp/project", isIdle: () => true, ui: { notify: () => undefined }, sessionManager: {} } as unknown as ExtensionContext;
  loop.start(ctx);
  assert.equal(loop.status.phase, "reviewing");
  assert.ok(loop.status.reviewId);
  await loop.cancel(ctx);
  assert.equal(endedBeforeStop, true);
  assert.equal(loop.status.phase, "ended");
  assert.equal(persisted.at(-1)?.phase, "ended");
  assert.deepEqual(statuses, ["reviewing", "ended"]);
  options.onResult({ decision: "approved", reviewId: loop.status.reviewId });
  assert.equal(loop.status.phase, "ended");
});

test("cancelは進行中restoreを無効化し、detach済み停止を待ってもレビューを再開させない", async () => {
  const persisted: ReviewState[] = [];
  const state = { version: 1 as const, reviewId: "review-race", phase: "reviewing" as const };
  let resolveStop!: () => void;
  let startCount = 0;
  const loop = new ReviewLoop({
    pi: { sendUserMessage: () => undefined },
    router: { persist: (value: ReviewState) => persisted.push(value), restore: () => state } as unknown as SessionRouter,
    serverEntry: "/tmp/diffai-server.js",
    notify: () => undefined,
    startProcess: () => {
      startCount++;
      return { stop: () => new Promise<void>(resolve => { resolveStop = resolve; }) };
    },
  });
  const context = (leafId: string) => ({
    cwd: "/tmp/project",
    isIdle: () => true,
    ui: { notify: () => undefined },
    sessionManager: { getSessionId: () => "session-1", getLeafId: () => leafId },
  }) as unknown as ExtensionContext;

  loop.start(context("old-leaf"));
  const restoring = loop.restore(context("new-leaf"), state);
  const cancelling = loop.cancel(context("new-leaf"));
  assert.equal(loop.phase, "ended");
  await Promise.resolve();
  assert.equal(typeof resolveStop, "function");
  resolveStop();
  await Promise.all([restoring, cancelling]);

  assert.equal(startCount, 1);
  assert.equal(loop.phase, "ended");
  assert.equal(persisted.at(-1)?.phase, "ended");
});

test("ReviewLoopのstopが未解決でも強制停止後に有限時間で戻る", async () => {
  let resolveStop!: () => void;
  let forceKillCount = 0;
  let startCount = 0;
  const loop = new ReviewLoop({
    pi: { sendUserMessage: () => undefined },
    router: { persist: () => undefined, restore: () => undefined } as unknown as SessionRouter,
    serverEntry: "/tmp/diffai-server.js",
    notify: () => undefined,
    stopTimeoutMs: 10,
    startProcess: () => {
      startCount++;
      return {
        stop: () => new Promise<void>(resolve => { resolveStop = resolve; }),
        forceKill: () => { forceKillCount++; },
      };
    },
  });
  const ctx = { cwd: "/tmp/project", isIdle: () => true, ui: { notify: () => undefined }, sessionManager: {} } as unknown as ExtensionContext;
  loop.start(ctx);
  const cancelling = loop.cancel(ctx);
  loop.start(ctx);
  await cancelling;
  assert.equal(startCount, 1);
  assert.equal(forceKillCount, 1);
  resolveStop();
});

test("SIGTERMを無視する子processは有限待機後にSIGKILLへescalateされる", async () => {
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });
  await new Promise(resolve => setTimeout(resolve, 50));
  const started = Date.now();
  await stopChildProcess(child, { termTimeoutMs: 20, killTimeoutMs: 100 });
  assert.ok(Date.now() - started < 500);
  assert.equal(child.signalCode, "SIGKILL");
});

test("close eventが来ない停止対象でも最終timeout後に返る", async () => {
  const signals: string[] = [];
  const child = new EventEmitter() as EventEmitter & { exitCode: number | null; signalCode: NodeJS.Signals | null; kill: (signal: NodeJS.Signals) => boolean };
  child.exitCode = null;
  child.signalCode = null;
  child.kill = signal => { signals.push(signal); return true; };
  const started = Date.now();
  await stopChildProcess(child as unknown as import("node:child_process").ChildProcess, { termTimeoutMs: 10, killTimeoutMs: 10 });
  assert.ok(Date.now() - started < 100);
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("復元した待機状態はagent_settledまで再レビューを起動しない", () => {
  const persisted: ReviewState[] = [];
  const router = { persist: (state: ReviewState) => persisted.push(state), restore: () => ({ version: 1 as const, reviewId: "review-123", phase: "waiting_for_agent" as const }) } as unknown as SessionRouter;
  const starts: string[] = [];
  let callbacks: { onResult: (result: { decision: "approved" | "changes_requested"; reviewId?: string }) => void } | undefined;
  const loop = new ReviewLoop({
    pi: { sendUserMessage: () => undefined },
    router,
    serverEntry: "/tmp/diffai-server.js",
    notify: () => undefined,
    startProcess: options => {
      starts.push(options.reviewId);
      callbacks = options;
      return { kill: () => undefined };
    },
  });
  const ctx = { cwd: "/tmp/project", isIdle: () => true, ui: { notify: () => undefined }, sessionManager: {} } as unknown as ExtensionContext;
  loop.restore(ctx);
  assert.deepEqual(starts, []);
  loop.agentSettled(ctx);
  assert.deepEqual(starts, ["review-123"]);
  callbacks?.onResult({ decision: "changes_requested", reviewId: "review-123" });
  assert.equal(loop.phase, "waiting_for_agent");
  assert.equal(persisted.at(-1)?.phase, "waiting_for_agent");
});
