import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const workspace = path.resolve("tests/.tmp/workspace");
rmSync(path.dirname(workspace), { recursive: true, force: true });
mkdirSync(workspace, { recursive: true });
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: workspace, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

git("init");
git("config", "user.email", "e2e@example.test");
git("config", "user.name", "diffai E2E");
const original = Array.from({ length: 140 }, (_, index) => `export const value${index + 1} = ${index + 1};`).join("\n") + "\n";
writeFileSync(path.join(workspace, "long-file.ts"), original);
git("add", ".");
git("commit", "-m", "Initial fixture commit");
const modified = original
  .replace("export const value20 = 20;", "export const value20 = 2000;")
  .replace("export const value100 = 100;", "export const renamedValue100 = 100;");
writeFileSync(path.join(workspace, "long-file.ts"), modified);
writeFileSync(path.join(workspace, "untracked.ts"), "export const untracked = true;\n");

const child = spawn(process.execPath, ["dist/server/index.js", "--cwd", workspace, "--port", "4321", "--no-open"], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => process.exit(code ?? 0));
