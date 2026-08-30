import { spawn, type ChildProcess } from "node:child_process";
import { parseReviewResultOutput, type ReviewResult } from "./protocol.js";

export type DiffaiProcessOptions = {
  serverEntry: string;
  cwd: string;
  reviewId: string;
  env?: NodeJS.ProcessEnv;
  onUrl?: (url: string) => void;
  onResult: (result: ReviewResult) => void | Promise<void>;
  onError: (error: Error) => void;
  onExitWithoutResult: (code: number | null) => void;
};

export function buildDiffaiArgs(options: Pick<DiffaiProcessOptions, "cwd" | "reviewId">): string[] {
  return ["--cwd", options.cwd, "--review-id", options.reviewId];
}

/** A bounded TERM -> KILL stop. The final timeout is deliberately finite even if a child never emits `close`. */
export type StopOptions = { termTimeoutMs?: number; killTimeoutMs?: number };

export async function stopChildProcess(child: ChildProcess, options: StopOptions = {}): Promise<void> {
  const termTimeoutMs = options.termTimeoutMs ?? 1_000;
  const killTimeoutMs = options.killTimeoutMs ?? 1_000;
  if (child.exitCode !== null || child.signalCode !== null) return;

  let closed = false;
  let resolveClose!: () => void;
  const close = new Promise<void>(resolve => { resolveClose = resolve; });
  const onClose = () => { closed = true; resolveClose(); };
  child.once("close", onClose);
  const wait = (timeoutMs: number): Promise<boolean> => {
    if (closed || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise(resolve => {
      let finished = false;
      const timer = setTimeout(() => { finished = true; resolve(false); }, timeoutMs);
      close.then(() => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(true);
      });
    }).then(() => closed || child.exitCode !== null || child.signalCode !== null);
  };

  try {
    try { child.kill("SIGTERM"); } catch { /* The process may have exited between the check and kill. */ }
    if (await wait(termTimeoutMs)) return;
    try { child.kill("SIGKILL"); } catch { /* The process may have exited between escalation and kill. */ }
    await wait(killTimeoutMs);
  } finally {
    // A child can report an exit code without ever emitting close (notably in
    // injected process handles). Do not retain the listener in that case.
    child.removeListener("close", onClose);
  }
}

/** Spawn the foreground CLI and collect its stable stdout result marker. */
export type DiffaiProcessHandle = { child: ChildProcess; kill: () => void; forceKill?: () => void; stop: () => Promise<void>; closed: Promise<void> };

export function startDiffaiProcess(options: DiffaiProcessOptions): DiffaiProcessHandle {
  const child = spawn(process.execPath, [options.serverEntry, ...buildDiffaiArgs(options)], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let settled = false;
  let resolveClosed!: () => void;
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
  let stopPromise: Promise<void> | undefined;
  child.stdout?.on("data", chunk => {
    const text = chunk.toString();
    stdout += text;
    const url = text.match(/https?:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (url) options.onUrl?.(url);
  });
  // stderr is diagnostic output; the result contract is stdout-only.
  child.once("error", error => {
    if (settled) return;
    settled = true;
    resolveClosed();
    options.onError(error instanceof Error ? error : new Error(String(error)));
  });
  child.once("close", code => {
    if (settled) { resolveClosed(); return; }
    settled = true;
    resolveClosed();
    try {
      const result = parseReviewResultOutput(stdout);
      if (result) void options.onResult(result);
      else options.onExitWithoutResult(code);
    } catch (error) {
      options.onError(error instanceof Error ? error : new Error(String(error)));
    }
  });
  return {
    child,
    // Kept for injected/test callers that need an immediate signal. Lifecycle
    // code uses stop(), which is bounded and escalates to SIGKILL.
    kill: () => { try { child.kill("SIGTERM"); } catch { /* Already closed. */ } },
    forceKill: () => { try { child.kill("SIGKILL"); } catch { /* Already closed. */ } },
    stop: () => stopPromise ??= stopChildProcess(child),
    closed,
  };
}
