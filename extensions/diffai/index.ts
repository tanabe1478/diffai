import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { ReviewLoop } from "./review-loop.js";
import { SessionRouter } from "./session-router.js";

export function isDiffaiCommand(command: string, cwd: string): boolean {
  return /(?:^|[;&|()]\s*)npx(?:\s+--?[\w.-]+(?:=[^\s]+)?)*\s+github:tanabe1478\/diffai(?:\s|$)/.test(command)
    || /(?:^|[;&|()]\s*)github:tanabe1478\/diffai(?:\s|$)/.test(command)
    || /(?:^|[;&|()]\s*)diffai(?:\s|$)/.test(command)
    || /(?:^|[;&|()]\s*)[^\s;&|()]*tanabe1478\/diffai(?:\s|$)/.test(command)
    || (/node\s+dist\/server\/index\.js/.test(command) && /(?:^|\/)diffai$/.test(cwd));
}

export function isDetached(command: string): boolean {
  return /(?:^|[\s;()])&(?!>)(?:\s|$)/.test(command) || /\b(?:nohup|disown)\b/.test(command);
}

export function redirectsStdout(command: string): boolean {
  return /(?:^|\s)(?:1?>|&>)\s*[^&\s]/.test(command) || /\|\s*tee\b/.test(command);
}

export function foregroundGuard(command: string, cwd: string): { block: true; reason: string } | undefined {
  if (!isDiffaiCommand(command, cwd) || (!isDetached(command) && !redirectsStdout(command))) return undefined;
  return {
    block: true,
    reason: [
      "diffai must run in the foreground so the agent receives its single bare ReviewResult v1 JSON line on stdout.",
      "Do not background it or redirect stdout to a log file.",
      "In Pi, prefer the /diffai-review command for an automatic review loop.",
      "Portable fallback: npx github:tanabe1478/diffai --cwd \"$PWD\"",
    ].join("\n"),
  };
}

export default function diffaiExtension(pi: ExtensionAPI): void {
  const router = new SessionRouter(pi);
  const serverEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/server/index.js");
  const notify = (ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info") => {
    try { ctx.ui.notify(message, type); } catch { /* Session may have switched. */ }
  };
  let lastContext: ExtensionContext | undefined;
  const syncStatus = (ctx: ExtensionContext, status = loop.status) => {
    lastContext = ctx;
    try {
      if (status.phase === "reviewing" || status.phase === "waiting_for_agent") {
        const review = status.reviewId ? ` (${status.reviewId})` : "";
        ctx.ui.setStatus("diffai-review", `diffai: ${status.phase}${review}`);
      } else {
        ctx.ui.setStatus("diffai-review", undefined);
      }
    } catch { /* UI-less and switched sessions must still run the state machine. */ }
  };
  const loop = new ReviewLoop({
    pi,
    router,
    serverEntry,
    notify,
    onStateChange: status => { if (lastContext) syncStatus(lastContext, status); },
  });

  pi.registerCommand("diffai-review", {
    description: "Open a persistent diffai review loop in the browser",
    handler: async (_args, ctx) => { syncStatus(ctx); loop.start(ctx); },
  });
  pi.registerCommand("diffai-status", {
    description: "Show the current diffai review lifecycle status",
    handler: async (_args, ctx) => {
      syncStatus(ctx);
      const status = loop.status;
      notify(ctx, status.reviewId ? `diffai: ${status.phase} (${status.reviewId})` : `diffai: ${status.phase}`);
    },
  });
  pi.registerCommand("diffai-cancel", {
    description: "Cancel the active diffai review",
    handler: async (_args, ctx) => { syncStatus(ctx); await loop.cancel(ctx); },
  });
  pi.on("session_start", async (_event, ctx) => { syncStatus(ctx); await loop.restore(ctx); syncStatus(ctx); });
  pi.on("session_tree", async (_event, ctx) => { syncStatus(ctx); await loop.restore(ctx); syncStatus(ctx); });
  pi.on("agent_settled", async (_event, ctx) => { syncStatus(ctx); loop.agentSettled(ctx); });
  pi.on("session_shutdown", async () => { await loop.shutdown(); });
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return undefined;
    return foregroundGuard(event.input.command, ctx.cwd);
  });
}
