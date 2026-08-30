import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { startDiffaiProcess, type DiffaiProcessOptions } from "./process.js";
import { type ReviewResult } from "./protocol.js";
import { getSessionIdentity, type ReviewState, SessionRouter, type SessionIdentity } from "./session-router.js";

export function formatReviewFeedback(result: ReviewResult): string {
  return [
    "# diffai review feedback",
    "",
    "ブラウザでコードレビューが完了しました。以下の指摘を確認し、必要な修正と検証を行ってください。",
    "",
    "```json",
    JSON.stringify(result, null, 2),
    "```",
    "",
    `対応後は ${result.replyFile ?? ".diffai/review-replies.json"} にコメントIDごとの返信を書いてください。`,
    "再レビューはdiffai拡張が同じブラウザタブへ自動で読み込むため、ユーザーに再レビューの起動を依頼しないでください。",
  ].join("\n");
}

export type ReviewLoopStatus = { phase: ReviewState["phase"] | "idle"; reviewId?: string };

type LoopOptions = {
  pi: Pick<ExtensionAPI, "sendUserMessage">;
  router: SessionRouter;
  serverEntry: string;
  notify: (ctx: ExtensionContext, message: string, type?: "info" | "warning" | "error") => void;
  onStateChange?: (status: ReviewLoopStatus) => void;
  /** Injectable for tests; production stop() is itself TERM/KILL bounded. */
  stopTimeoutMs?: number;
  startProcess?: (options: DiffaiProcessOptions) => { kill?: () => void; forceKill?: () => void; stop?: () => Promise<void>; closed?: Promise<void> };
};

type ProcessHandle = { kill?: () => void; forceKill?: () => void; stop?: () => Promise<void>; closed?: Promise<void> };
type ProcessRun = {
  generation: number;
  identity: SessionIdentity;
  reviewId: string;
  invalidated: boolean;
  handle?: ProcessHandle;
};

function sameSessionPosition(left: SessionIdentity, right: SessionIdentity): boolean {
  return left.sessionId === right.sessionId && left.leafId === right.leafId;
}

export class ReviewLoop {
  private state: ReviewState | undefined;
  private process?: ProcessRun;
  private launchGeneration = 0;
  private restoreGeneration = 0;
  private shuttingDown = false;
  private stopping?: Promise<void>;
  private readonly stopTimeoutMs: number;

  constructor(private readonly options: LoopOptions) {
    this.options.startProcess ??= startDiffaiProcess;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 2_500;
  }

  get phase(): ReviewState["phase"] | "idle" {
    return this.state?.phase ?? "idle";
  }

  /** A snapshot for commands/UI; callers cannot mutate the persisted state. */
  get status(): ReviewLoopStatus {
    return this.state ? { phase: this.state.phase, reviewId: this.state.reviewId } : { phase: "idle" };
  }

  getStatus(): ReviewLoopStatus {
    return this.status;
  }

  start(ctx: ExtensionContext): void {
    if (this.shuttingDown) return;
    if (this.stopping) {
      this.options.notify(ctx, "diffai review is still stopping; please retry shortly.", "warning");
      return;
    }
    if (this.state?.phase === "reviewing" || this.state?.phase === "waiting_for_agent") {
      this.options.notify(ctx, "diffai review loop is already active.", "warning");
      return;
    }
    this.transition({ version: 1, reviewId: randomUUID(), phase: "reviewing" });
    this.launch(ctx);
  }

  async restore(ctx: ExtensionContext, state = this.options.router.restore(ctx)): Promise<void> {
    const restoreGeneration = ++this.restoreGeneration;
    const identity = getSessionIdentity(ctx);
    const process = this.process;
    const canKeepProcess = Boolean(
      process &&
      state?.phase === "reviewing" &&
      process.reviewId === state.reviewId &&
      sameSessionPosition(process.identity, identity),
    );

    // Invalidate before waiting for close. A child may resolve `closed` before
    // its result/error callback runs, so awaiting close alone is not a fence.
    if (process && !canKeepProcess) {
      this.invalidateProcess(process);
      await this.stopProcess(process);
    } else if (this.stopping) {
      // A cancel/shutdown may have already detached the process. Do not
      // resurrect a new run until that bounded stop has completed.
      await this.stopping;
    }

    // A second tree/session event supersedes an older restore that was waiting
    // for a process to close.
    if (restoreGeneration !== this.restoreGeneration || this.shuttingDown) return;
    this.state = state;
    this.options.onStateChange?.(this.status);
    if (state?.phase === "reviewing" && !this.process) this.launch(ctx);
  }

  agentSettled(ctx: ExtensionContext): void {
    if (this.state?.phase !== "waiting_for_agent" || this.process || this.shuttingDown) return;
    this.transition({ ...this.state, phase: "reviewing" });
    this.options.notify(ctx, "diffai: loading the updated diff for re-review.");
    this.launch(ctx);
  }

  async cancel(ctx: ExtensionContext): Promise<void> {
    // An in-flight restore may already have detached its process and be
    // waiting on this.stopping. Invalidate that restore before persisting
    // ended so it cannot restore reviewing after cancellation completes.
    ++this.restoreGeneration;
    const state = this.state;
    const process = this.process;
    // Fence callbacks before persisting ended. In particular, a close event
    // must not turn an explicit cancellation into an unrelated error/result.
    if (process) this.invalidateProcess(process);
    if (state && (state.phase === "reviewing" || state.phase === "waiting_for_agent")) {
      this.transition({ ...state, phase: "ended" });
      this.options.notify(ctx, "diffai review cancelled.");
    }
    if (process) await this.stopProcess(process);
    else if (this.stopping) await this.stopping;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    ++this.restoreGeneration;
    const process = this.process;
    if (process) this.invalidateProcess(process);
    if (process) await this.stopProcess(process);
    else if (this.stopping) await this.stopping;
    this.options.onStateChange?.({ phase: "idle" });
  }

  private transition(state: ReviewState): void {
    this.state = state;
    this.options.router.persist(state);
    this.options.onStateChange?.(this.status);
  }

  private invalidateProcess(process: ProcessRun): void {
    process.invalidated = true;
    if (this.process === process) this.process = undefined;
  }

  private waitBounded(operation: Promise<void>): Promise<boolean> {
    return new Promise(resolve => {
      let finished = false;
      const timer = setTimeout(() => { finished = true; resolve(false); }, this.stopTimeoutMs);
      operation.then(
        () => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          resolve(true);
        },
        () => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          resolve(false);
        },
      );
    });
  }

  private stopProcess(process: ProcessRun): Promise<void> {
    const previous = this.stopping;
    const task = (async () => {
      if (previous) await previous;
      const handle = process.handle;
      if (!handle) return;

      let stopped = false;
      if (handle.stop) {
        stopped = await this.waitBounded(Promise.resolve().then(() => handle.stop!()));
        if (!stopped) {
          // Preserve the same escalation order for injected handles whose
          // stop() failed before completing: TERM first, then KILL.
          handle.kill?.();
          handle.forceKill?.();
        }
        return;
      }

      handle.kill?.();
      const closed = handle.closed ? await this.waitBounded(handle.closed) : false;
      if (!closed) handle.forceKill?.();
    })();
    const tracked = task.finally(() => {
      if (this.stopping === tracked) this.stopping = undefined;
    });
    this.stopping = tracked;
    return tracked;
  }

  private launch(ctx: ExtensionContext): void {
    const state = this.state;
    if (!state || state.phase !== "reviewing" || this.process || this.shuttingDown) return;
    const run: ProcessRun = {
      generation: ++this.launchGeneration,
      identity: getSessionIdentity(ctx),
      reviewId: state.reviewId,
      invalidated: false,
    };
    this.process = run;
    const isCurrent = () => !run.invalidated && this.process === run
      && this.process.generation === run.generation && !this.shuttingDown
      && sameSessionPosition(run.identity, getSessionIdentity(ctx))
      && this.state?.phase === "reviewing" && this.state.reviewId === run.reviewId;
    const finish = (callback: () => void) => {
      if (!isCurrent()) return;
      this.process = undefined;
      callback();
    };
    try {
      const handle = this.options.startProcess!({
        serverEntry: this.options.serverEntry,
        cwd: ctx.cwd,
        reviewId: state.reviewId,
        onUrl: url => { if (isCurrent()) this.options.notify(ctx, `diffai review opened: ${url}`); },
        onResult: result => finish(() => this.handleResult(ctx, result)),
        onError: error => finish(() => {
          this.transition({ ...state, phase: "ended" });
          this.options.notify(ctx, `diffai could not start: ${error.message}`, "error");
        }),
        onExitWithoutResult: code => finish(() => {
          this.transition({ ...state, phase: "ended" });
          this.options.notify(ctx, `diffai review ended without a result${code === 0 ? "" : ` (exit ${code})`}.`, "error");
        }),
      });
      run.handle = handle;
      // A synchronously-fired callback can finish the run before spawn returns.
      if (!isCurrent()) {
        run.invalidated = true;
        void this.stopProcess(run);
      }
    } catch (error) {
      finish(() => {
        this.transition({ ...state, phase: "ended" });
        this.options.notify(ctx, `diffai could not start: ${error instanceof Error ? error.message : String(error)}`, "error");
      });
    }
  }

  private handleResult(ctx: ExtensionContext, result: ReviewResult): void {
    const state = this.state;
    // Older CLI results did not carry reviewId; accept those while rejecting
    // an explicitly mismatched id from a concurrent review.
    if (!state) return;
    if (result.reviewId !== undefined && result.reviewId !== state.reviewId) {
      this.transition({ ...state, phase: "ended" });
      this.options.notify(ctx, "diffai returned a result for a different reviewId.", "error");
      return;
    }
    if (result.decision === "approved") {
      this.transition({ ...state, phase: "ended" });
      this.options.notify(ctx, "diffai: changes approved.");
      return;
    }
    this.transition({ ...state, phase: "waiting_for_agent" });
    this.options.pi.sendUserMessage(formatReviewFeedback(result), ctx.isIdle() ? undefined : { deliverAs: "followUp" });
    this.options.notify(ctx, "diffai feedback was sent to Pi. The review will refresh after the changes.");
  }
}
