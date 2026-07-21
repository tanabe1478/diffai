#!/usr/bin/env node
import express from "express";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { WebSocketServer, WebSocket } from "ws";
import open from "open";
import type { GitCommit, GitRef, Proposal, ReviewReply, ServerEvent } from "../src/types.js";

function arg(name: string) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; }
const cwd = path.resolve(arg("cwd") ?? process.cwd());
const requestedPort = Number(arg("port") ?? 4317);
const dev = process.argv.includes("--dev");
const serveMode = dev || process.argv.includes("--serve");
const waitMode = true;
let reviewSessionId = randomUUID();
const sessionDescriptor = path.join(tmpdir(), `diffai-${createHash("sha256").update(cwd).digest("hex").slice(0, 16)}.json`);

type SessionDescriptor = { cwd: string; port: number; pid: number };

async function activeSession(): Promise<SessionDescriptor | undefined> {
  try {
    const descriptor = JSON.parse(await fs.readFile(sessionDescriptor, "utf8")) as SessionDescriptor;
    const response = await fetch(`http://127.0.0.1:${descriptor.port}/api/state`, { signal: AbortSignal.timeout(1_000) });
    if (response.ok && (await response.json() as { cwd: string }).cwd === cwd) return descriptor;
  } catch { /* Stale or missing descriptor. */ }
  await fs.rm(sessionDescriptor, { force: true });
  return undefined;
}

async function waitForServer(port: number) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/state`)).ok) return; } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 125));
  }
  throw new Error("diffai server did not start");
}

async function waitForReviewResult(port: number, after: number) {
  const notice = setInterval(() => console.log("状態: ブラウザでのレビュー完了を待っています…"), 30_000);
  notice.unref();
  try {
    while (true) {
      const response = await fetch(`http://127.0.0.1:${port}/api/review-result?after=${after}`);
      if (response.status === 200) return await response.json();
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  } finally { clearInterval(notice); }
}

async function runWaiter() {
  let descriptor = await activeSession();
  let after = 0;
  if (descriptor) {
    const state = await fetch(`http://127.0.0.1:${descriptor.port}/api/state`).then(response => response.json()) as { resultCount: number };
    after = state.resultCount;
    const response = await fetch(`http://127.0.0.1:${descriptor.port}/api/reload`, { method: "POST" });
    if (!response.ok) throw new Error(`diffai reload failed: ${response.status}`);
    console.log(`diffai: http://127.0.0.1:${descriptor.port}\nworkspace: ${cwd}\n状態: 同じブラウザで再レビュー待ち`);
  } else {
    const port = await availablePort(requestedPort);
    const modulePath = fileURLToPath(import.meta.url);
    const child = spawn(process.execPath, [...process.execArgv, modulePath, "--serve", "--cwd", cwd, "--port", String(port), "--no-open"], { detached: true, stdio: "ignore" });
    child.unref();
    descriptor = { cwd, port, pid: child.pid! };
    await waitForServer(port);
    await fs.writeFile(sessionDescriptor, JSON.stringify(descriptor), "utf8");
    const url = `http://127.0.0.1:${port}`;
    console.log(`diffai: ${url}\nworkspace: ${cwd}\n状態: ブラウザでのレビュー待ち\n操作: 全ファイルを判断し「レビューを完了」を押してください`);
    if (!process.argv.includes("--no-open")) await open(url);
  }
  const result = await waitForReviewResult(descriptor.port, after);
  console.log(`DIFFAI_REVIEW_RESULT=${JSON.stringify(result)}`);
}

if (!serveMode) {
  await runWaiter();
  process.exit(0);
}

let reviewProposals: Proposal[] = [];
let commits: GitCommit[] = [];
let refs: GitRef[] = [];
const clients = new Set<WebSocket>();
const reviewResults: unknown[] = [];

function send(event: ServerEvent, ws?: WebSocket) {
  const text = JSON.stringify(event);
  if (ws) { if (ws.readyState === WebSocket.OPEN) ws.send(text); return; }
  for (const client of clients) if (client.readyState === WebSocket.OPEN) client.send(text);
}
function safePath(relative: string) {
  const absolute = path.resolve(cwd, relative);
  const rel = path.relative(cwd, absolute);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Workspace外のパスは変更できません");
  return absolute;
}
function isBinary(buffer: Buffer) { return buffer.subarray(0, 8000).includes(0); }
function decodeContent(buffer: Buffer) {
  if (!isBinary(buffer)) return buffer.toString("utf8");
  const digest = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
  return `Binary file (${buffer.length} bytes, sha256 ${digest})`;
}
async function readOrEmpty(file: string) { try { return decodeContent(await fs.readFile(file)); } catch (e: any) { if (e.code === "ENOENT") return ""; throw e; } }
async function loadReviewReplies(): Promise<ReviewReply[]> {
  try {
    const text = await fs.readFile(safePath(".diffai/review-replies.json"), "utf8");
    const parsed = JSON.parse(text) as { replies?: ReviewReply[] } | ReviewReply[];
    return Array.isArray(parsed) ? parsed : parsed.replies ?? [];
  } catch (error: any) {
    if (error.code !== "ENOENT") console.warn(`diffai: review replies could not be loaded: ${error.message}`);
    return [];
  }
}
const exec = promisify(execFile);
async function git(args: string[]) { return (await exec("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 })).stdout.trimEnd(); }
async function gitContent(spec: string) {
  try {
    const { stdout } = await exec("git", ["show", spec], { cwd, maxBuffer: 20 * 1024 * 1024, encoding: "buffer" });
    return isBinary(stdout) ? decodeContent(stdout) : stdout.toString("utf8").trimEnd();
  } catch { return ""; }
}
async function listCommits(): Promise<GitCommit[]> {
  const output = await git(["log", "-30", "--date=iso-strict", "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%ad"]);
  return output ? output.split("\n").map(line => { const [hash, shortHash, subject, author, date] = line.split("\x1f"); return { hash, shortHash, subject, author, date }; }) : [];
}
async function listRefs(): Promise<GitRef[]> {
  const output = await git(["for-each-ref", "--format=%(refname:short)|||%(objectname)", "refs/heads", "refs/remotes"]);
  return output ? output.split("\n").map(line => { const [name, hash] = line.split("|||"); return { name, hash }; }) : [];
}
async function loadGitReview(target: string, compareWith?: string) {
  let names: string[] = [], label = target;
  const lines = (value: string) => value ? value.split("\n").filter(Boolean) : [];
  if (target === "working") { names = [...new Set([...lines(await git(["diff", "--name-only"])), ...lines(await git(["ls-files", "--others", "--exclude-standard"]))])]; label = "未ステージの変更"; }
  else if (target === "staged") { names = lines(await git(["diff", "--cached", "--name-only"])); label = "ステージ済みの変更"; }
  else if (target === "uncommitted") { names = [...new Set([...lines(await git(["diff", "HEAD", "--name-only"])), ...lines(await git(["ls-files", "--others", "--exclude-standard"]))])]; label = "未コミットの変更"; }
  else if (target === "compare" && compareWith) { const [base, head] = compareWith.split("\x1f"); names = lines(await git(["diff", "--name-only", base, head])); label = `${base} … ${head}`; }
  else { const hash = target === "latest" ? "HEAD" : target; names = lines(await git(["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", hash])); label = await git(["show", "-s", "--format=%h %s", hash]); }
  names = names.filter(file => file !== ".diffai/review-replies.json");
  reviewProposals = await Promise.all(names.map(async file => {
    let before = "", after = "";
    if (target === "working") { before = await gitContent(`:${file}`); after = await readOrEmpty(safePath(file)); }
    else if (target === "staged") { before = await gitContent(`HEAD:${file}`); after = await gitContent(`:${file}`); }
    else if (target === "uncommitted") { before = await gitContent(`HEAD:${file}`); after = await readOrEmpty(safePath(file)); }
    else if (target === "compare" && compareWith) { const [base, head] = compareWith.split("\x1f"); before = await gitContent(`${base}:${file}`); after = await gitContent(`${head}:${file}`); }
    else { const hash = target === "latest" ? "HEAD" : target; before = await gitContent(`${hash}^:${file}`); after = await gitContent(`${hash}:${file}`); }
    return { id: `review:${target}:${compareWith ?? ""}:${file}`, path: file, before, after, summary: label, status: "pending" as const, reviewOnly: true };
  }));
  return { label, proposals: reviewProposals };
}
let reviewReplies: ReviewReply[] = [];
try { commits = await listCommits(); refs = await listRefs(); reviewReplies = await loadReviewReplies(); await loadGitReview("uncommitted"); } catch { /* The workspace may not be a Git repository yet. */ }

const app = express();
app.use(express.json());
app.get("/api/state", (_req, res) => res.json({ cwd, resultCount: reviewResults.length }));
app.get("/api/review-result", (req, res) => {
  const after = Number(req.query.after ?? 0);
  if (Number.isInteger(after) && after >= 0 && after < reviewResults.length) res.json(reviewResults[after]);
  else res.sendStatus(204);
});
app.post("/api/reload", async (_req, res) => {
  try {
    reviewSessionId = randomUUID();
    reviewReplies = await loadReviewReplies();
    const loaded = await loadGitReview("uncommitted");
    send({ type: "review_loaded", cwd, ...loaded, reviewSessionId, replies: reviewReplies });
    res.json({ reviewSessionId });
  } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : String(error) }); }
});
if (!dev) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  app.use(express.static(path.resolve(here, "../client")));
  app.get("/{*splat}", (_req, res) => res.sendFile(path.resolve(here, "../client/index.html")));
}
const server = createServer(app); const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  clients.add(ws);
  send({ type: "ready", cwd, proposals: reviewProposals, commits, refs, waitMode, initialTarget: "uncommitted", reviewSessionId, replies: reviewReplies }, ws);
  ws.on("close", () => clients.delete(ws));
  ws.on("message", async (raw) => {
    try {
      const command = JSON.parse(raw.toString());
      if (command.type === "complete_review") {
        const items = reviewProposals;
        const submittedStatuses = new Map<string, Proposal["status"]>((command.reviews ?? []).map((review: { id: string; status: Proposal["status"] }) => [review.id, review.status]));
        for (const item of items) { const submitted = submittedStatuses.get(item.id); if (submitted) item.status = submitted; }
        const pending = items.filter(item => item.status === "pending");
        if (pending.length) throw new Error(`未確認のファイルが ${pending.length} 件あります`);
        const feedback = command.feedback ?? {};
        const fileFeedback = items
          .map(item => ({ id: `feedback:${item.id}`, proposalId: item.id, path: item.path, body: feedback[item.id] }))
          .filter(item => typeof item.body === "string" && item.body.trim());
        const result = {
          decision: items.some(item => item.status === "rejected") ? "changes_requested" : "approved",
          reviews: items.map(item => ({ id: item.id, path: item.path, status: item.status, feedback: item.feedback })),
          comments: command.comments ?? [], fileFeedback, feedback,
          replyFile: ".diffai/review-replies.json",
          replyFormat: { replies: [{ commentId: "<comment id or fileFeedback id>", status: "fixed|replied|wontfix", body: "<reply shown in diffai>" }] },
        };
        reviewResults.push(result);
        setTimeout(() => send({ type: "status", status: "completed", detail: result.decision }), 350);
      } else if (command.type === "load_review") {
        const loaded = await loadGitReview(command.target, command.compareWith);
        send({ type: "review_loaded", cwd, ...loaded, reviewSessionId, replies: reviewReplies });
      } else if (command.type === "review") {
        const proposal = reviewProposals.find(item => item.id === command.id); if (!proposal) throw new Error("提案が見つかりません");
        proposal.feedback = command.feedback;
        proposal.status = command.decision === "approve" ? "approved" : "rejected";
        send({ type: "proposal_updated", proposal });
      }
    } catch (error) { send({ type: "error", message: error instanceof Error ? error.message : String(error) }, ws); }
  });
});
async function availablePort(start: number) {
  for (let candidate = start; candidate < start + 20; candidate++) {
    const available = await new Promise<boolean>(resolve => { const probe = createNetServer(); probe.once("error", () => resolve(false)); probe.listen(candidate, "127.0.0.1", () => probe.close(() => resolve(true))); });
    if (available) return candidate;
  }
  throw new Error(`${start} から利用可能なポートが見つかりません`);
}
const port = await availablePort(requestedPort);
server.listen(port, "127.0.0.1", async () => {
  const url = `http://127.0.0.1:${dev ? 5173 : port}`;
  console.log(`diffai: ${url}\nworkspace: ${cwd}`);
  if (port !== requestedPort) console.log(`port ${requestedPort} は使用中のため ${port} を使用します`);
  if (waitMode) console.log("状態: ブラウザでのレビュー待ち\n操作: 全ファイルを判断し「レビューを完了」を押してください");
  if (!process.argv.includes("--no-open")) await open(url);
});
const waitingNotice = waitMode ? setInterval(() => console.log("状態: ブラウザでのレビュー完了を待っています…"), 30_000) : undefined;
if (waitingNotice) waitingNotice.unref();
