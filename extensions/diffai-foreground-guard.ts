import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

type ReviewResult = {
  decision?: "approved" | "changes_requested";
  reviews?: unknown[];
  comments?: unknown[];
  fileFeedback?: unknown[];
  feedback?: unknown;
  replyFile?: string;
  replyFormat?: unknown;
};

type ExtensionContext = {
  cwd: string;
  isIdle(): boolean;
  ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
};

type ExtensionAPI = {
  on(event: "tool_call", handler: (event: { toolName: string; input: { command?: unknown } }, ctx: ExtensionContext) => unknown): void;
  on(event: "agent_settled", handler: (event: unknown, ctx: ExtensionContext) => unknown): void;
  on(event: "session_shutdown", handler: (event: unknown, ctx: ExtensionContext) => unknown): void;
  registerCommand(name: string, options: { description: string; handler: (args: string, ctx: ExtensionContext) => unknown }): void;
  sendUserMessage(content: string, options?: { deliverAs: "steer" | "followUp" }): void;
};

function isDiffaiCommand(command: string, cwd: string) {
  return /(?:^|\s)npx(?:\s+--?[\w.-]+(?:=[^\s]+)?)*\s+github:tanabe1478\/diffai(?:\s|$)/.test(command)
    || /(?:^|\s)github:tanabe1478\/diffai(?:\s|$)/.test(command)
    || /(?:^|\s)diffai(?:\s|$)/.test(command)
    || /tanabe1478\/diffai/.test(command)
    || (/node\s+dist\/server\/index\.js/.test(command) && /(?:^|\/)diffai$/.test(cwd));
}

function isDetached(command: string) {
  return /(?:^|[\s;()])&(?!>)(?:\s|$)/.test(command)
    || /\b(?:nohup|disown)\b/.test(command);
}

function redirectsStdout(command: string) {
  return /(?:^|\s)(?:1?>|&>)\s*[^&\s]/.test(command)
    || /\|\s*tee\b/.test(command);
}

export function formatReviewFeedback(result: ReviewResult) {
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

export default function (pi: ExtensionAPI) {
  let waiter: ChildProcess | undefined;
  let reviewLoopActive = false;
  let waitingForAgent = false;
  let shuttingDown = false;

  const notify = (ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info") => {
    try { ctx.ui.notify(message, type); } catch { /* Session may have switched. */ }
  };

  const startReview = (ctx: ExtensionContext) => {
    if (waiter || shuttingDown) {
      if (waiter) notify(ctx, "diffai review is already open.", "warning");
      return;
    }

    const serverEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/server/index.js");
    let output = "";
    const child = spawn(process.execPath, [serverEntry, "--cwd", ctx.cwd], {
      cwd: ctx.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    waiter = child;
    reviewLoopActive = true;
    waitingForAgent = false;

    child.stdout.on("data", chunk => {
      output += chunk.toString();
      const url = chunk.toString().match(/https?:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) notify(ctx, `diffai review opened: ${url}`);
    });
    child.stderr.on("data", chunk => { output += chunk.toString(); });
    child.on("error", error => {
      waiter = undefined;
      reviewLoopActive = false;
      notify(ctx, `diffai could not start: ${error.message}`, "error");
    });
    child.on("close", code => {
      waiter = undefined;
      if (shuttingDown) return;
      const marker = output.match(/DIFFAI_REVIEW_RESULT=(\{[^\n]*\})/);
      if (!marker) {
        reviewLoopActive = false;
        notify(ctx, `diffai review ended without a result${code === 0 ? "" : ` (exit ${code})`}.`, "error");
        return;
      }

      try {
        const result = JSON.parse(marker[1]) as ReviewResult;
        if (result.decision === "approved") {
          reviewLoopActive = false;
          notify(ctx, "diffai: changes approved.");
          return;
        }
        waitingForAgent = true;
        pi.sendUserMessage(formatReviewFeedback(result), ctx.isIdle() ? undefined : { deliverAs: "followUp" });
        notify(ctx, "diffai feedback was sent to Pi. The review will refresh after the changes.");
      } catch (error) {
        reviewLoopActive = false;
        notify(ctx, `diffai returned an invalid result: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    });
  };

  pi.registerCommand("diffai-review", {
    description: "Open a persistent diffai review loop in the browser",
    handler: async (_args, ctx) => {
      if (reviewLoopActive) {
        notify(ctx, "diffai review loop is already active.", "warning");
        return;
      }
      startReview(ctx);
    },
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!reviewLoopActive || !waitingForAgent || waiter || shuttingDown) return;
    waitingForAgent = false;
    notify(ctx, "diffai: loading the updated diff for re-review.");
    startReview(ctx);
  });

  pi.on("session_shutdown", async () => {
    shuttingDown = true;
    waiter?.kill("SIGTERM");
    waiter = undefined;
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;

    const command = typeof event.input.command === "string" ? event.input.command : "";
    if (!isDiffaiCommand(command, ctx.cwd)) return undefined;

    if (isDetached(command) || redirectsStdout(command)) {
      return {
        block: true,
        reason: [
          "diffai must run in the foreground so the agent receives DIFFAI_REVIEW_RESULT.",
          "Do not background it or redirect stdout to a log file.",
          "In Pi, prefer the /diffai-review command for an automatic review loop.",
          "Portable fallback: npx github:tanabe1478/diffai --cwd \"$PWD\"",
        ].join("\n"),
      };
    }

    return undefined;
  });
}
