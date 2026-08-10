// コミットが1つもない(unborn branch)リポジトリの fixture でサーバを起動する
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const workspace = path.resolve("tests/.tmp-unborn/workspace");
rmSync(path.dirname(workspace), { recursive: true, force: true });
mkdirSync(workspace, { recursive: true });
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: workspace, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

git("init", "-b", "master");
git("config", "user.email", "e2e@example.test");
git("config", "user.name", "diffai E2E");
writeFileSync(path.join(workspace, "staged.ts"), "export const staged = true;\n");
git("add", "staged.ts");
writeFileSync(path.join(workspace, "untracked.ts"), "export const untracked = true;\n");

const child = spawn(process.execPath, ["dist/server/index.js", "--serve", "--cwd", workspace, "--port", "4322", "--no-open"], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => process.exit(code ?? 0));
