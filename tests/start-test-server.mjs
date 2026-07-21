import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

const workspace = path.resolve("tests/.tmp/workspace");
rmSync(path.dirname(workspace), { recursive: true, force: true });
mkdirSync(workspace, { recursive: true });
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: workspace, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

git("init", "-b", "master");
git("config", "user.email", "e2e@example.test");
git("config", "user.name", "diffai E2E");
const original = Array.from({ length: 140 }, (_, index) => `export const value${index + 1} = ${index + 1};`).join("\n") + "\n";
mkdirSync(path.join(workspace, "src"), { recursive: true });
writeFileSync(path.join(workspace, "src", "long-file.ts"), original);
git("add", ".");
git("commit", "-m", "Initial fixture commit");
git("checkout", "-b", "feature");
writeFileSync(path.join(workspace, "feature.ts"), "export const feature = true;\n");
git("add", ".");
git("commit", "-m", "Add fixture feature");
git("checkout", "master");
const modified = original
  .replace("export const value20 = 20;", "export const value20 = 2000;")
  .replace("export const value100 = 100;", "export const renamedValue100 = 100;");
writeFileSync(path.join(workspace, "src", "long-file.ts"), modified);
writeFileSync(path.join(workspace, "untracked.ts"), "export const untracked = true;\n");
mkdirSync(path.join(workspace, "formal"), { recursive: true });
writeFileSync(path.join(workspace, "formal", "StudyDict.tla"), `---- MODULE StudyDict ----
EXTENDS FiniteSets

\\* TLA+ syntax highlighting fixture
CONSTANTS Instances
VARIABLE disk

NoLostUpdate == disk \\subseteq Instances
====
`);
mkdirSync(path.join(workspace, "syntax"), { recursive: true });
writeFileSync(path.join(workspace, "syntax", "README.md"), "# Highlight fixture\n\n`inline code`\n");
writeFileSync(path.join(workspace, "syntax", "config.json"), "{\"enabled\": true}\n");
writeFileSync(path.join(workspace, "syntax", "Example.swift"), "struct Example { let value: Int }\n");
mkdirSync(path.join(workspace, ".diffai"), { recursive: true });
writeFileSync(path.join(workspace, ".diffai", "review-replies.json"), JSON.stringify({ replies: [
  { commentId: "feedback:review:uncommitted::src/long-file.ts", status: "fixed", body: "値の変更を確認しました" }
] }, null, 2));

const child = spawn(process.execPath, ["dist/server/index.js", "--serve", "--cwd", workspace, "--port", "4321", "--no-open"], { stdio: "inherit" });
const descriptorPath = path.join(tmpdir(), `diffai-${createHash("sha256").update(workspace).digest("hex").slice(0, 16)}.json`);
writeFileSync(descriptorPath, JSON.stringify({ cwd: workspace, port: 4321, pid: child.pid }));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  rmSync(descriptorPath, { force: true });
  child.kill(signal);
});
child.on("exit", code => {
  rmSync(descriptorPath, { force: true });
  process.exit(code ?? 0);
});
