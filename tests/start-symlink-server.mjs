// シンボリックリンク(ディレクトリへのリンクを含む)がある fixture でサーバを起動する
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const workspace = path.resolve("tests/.tmp-symlink/workspace");
rmSync(path.dirname(workspace), { recursive: true, force: true });
mkdirSync(workspace, { recursive: true });
const git = (...args) => {
  const result = spawnSync("git", args, { cwd: workspace, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

git("init", "-b", "master");
git("config", "user.email", "e2e@example.test");
git("config", "user.name", "diffai E2E");
mkdirSync(path.join(workspace, "skills", "guide"), { recursive: true });
writeFileSync(path.join(workspace, "skills", "guide", "SKILL.md"), "# guide\n");
writeFileSync(path.join(workspace, "app.ts"), "export const app = 1;\n");
git("add", ".");
git("commit", "-m", "Initial fixture commit");
writeFileSync(path.join(workspace, "app.ts"), "export const app = 2;\n");
// 未追跡のディレクトリへのリンクとファイルへのリンク
mkdirSync(path.join(workspace, "package", "skills"), { recursive: true });
symlinkSync("../../skills/guide", path.join(workspace, "package", "skills", "guide"));
symlinkSync("app.ts", path.join(workspace, "alias.ts"));

const child = spawn(process.execPath, ["dist/server/index.js", "--serve", "--cwd", workspace, "--port", "4323", "--no-open"], { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => process.exit(code ?? 0));
