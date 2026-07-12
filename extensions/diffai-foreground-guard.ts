import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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

export default function (pi: ExtensionAPI) {
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
          "Run: npx github:tanabe1478/diffai --cwd \"$PWD\"",
        ].join("\n"),
      };
    }

    return undefined;
  });
}
