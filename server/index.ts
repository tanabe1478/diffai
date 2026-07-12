#!/usr/bin/env node
import express from "express";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WebSocketServer, WebSocket } from "ws";
import open from "open";
import { Type } from "typebox";
import {
  AuthStorage, createAgentSession, DefaultResourceLoader, defineTool,
  ModelRegistry, SessionManager, getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type { GitCommit, GitRef, Proposal, ServerEvent } from "../src/types.js";

function arg(name: string) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; }
const cwd = path.resolve(arg("cwd") ?? process.cwd());
const requestedPort = Number(arg("port") ?? 4317);
const dev = process.argv.includes("--dev");
const waitMode = true;
const proposals = new Map<string, Proposal>();
let reviewProposals: Proposal[] = [];
let commits: GitCommit[] = [];
let refs: GitRef[] = [];
const clients = new Set<WebSocket>();

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
async function readOrEmpty(file: string) { try { return await fs.readFile(file, "utf8"); } catch (e: any) { if (e.code === "ENOENT") return ""; throw e; } }
const exec = promisify(execFile);
async function git(args: string[]) { return (await exec("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 })).stdout.trimEnd(); }
async function gitContent(spec: string) { try { return await git(["show", spec]); } catch { return ""; } }
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
function addProposal(pathName: string, before: string, after: string, summary: string) {
  const proposal: Proposal = { id: randomUUID(), path: pathName, before, after, summary, status: "pending" };
  proposals.set(proposal.id, proposal); send({ type: "proposal", proposal }); return proposal;
}

const proposeEdit = defineTool({
  name: "propose_edit", label: "Propose edit",
  description: "Propose an exact text replacement for browser review. Does not modify the file.",
  parameters: Type.Object({ path: Type.String(), oldText: Type.String(), newText: Type.String(), summary: Type.String() }),
  execute: async (_id, input) => {
    const file = safePath(input.path); const before = await readOrEmpty(file);
    const count = before.split(input.oldText).length - 1;
    if (!input.oldText || count !== 1) throw new Error(`oldText must occur exactly once (found ${count})`);
    const proposal = addProposal(input.path, before, before.replace(input.oldText, input.newText), input.summary);
    return { content: [{ type: "text" as const, text: `Proposal ${proposal.id} is waiting for user review.` }], details: { proposalId: proposal.id } };
  },
});
const proposeWrite = defineTool({
  name: "propose_write", label: "Propose file",
  description: "Propose complete file contents for browser review. Does not modify the file.",
  parameters: Type.Object({ path: Type.String(), content: Type.String(), summary: Type.String() }),
  execute: async (_id, input) => {
    const before = await readOrEmpty(safePath(input.path));
    const proposal = addProposal(input.path, before, input.content, input.summary);
    return { content: [{ type: "text" as const, text: `Proposal ${proposal.id} is waiting for user review.` }], details: { proposalId: proposal.id } };
  },
});

try { commits = await listCommits(); refs = await listRefs(); if (waitMode) await loadGitReview("uncommitted"); } catch { /* The workspace may not be a Git repository yet. */ }

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
const loader = new DefaultResourceLoader({
  cwd, agentDir: getAgentDir(),
  systemPromptOverride: (base) => `${base ?? "You are a coding assistant."}\n\nYou are connected to diffai. Never modify files using shell commands. Use propose_edit or propose_write for every file change so the user can review it in the browser.`,
});
await loader.reload();
const { session } = await createAgentSession({
  cwd, authStorage, modelRegistry, resourceLoader: loader,
  sessionManager: SessionManager.create(cwd),
  tools: ["read", "grep", "find", "ls", "bash", "propose_edit", "propose_write"],
  customTools: [proposeEdit, proposeWrite],
});
session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") send({ type: "text_delta", delta: event.assistantMessageEvent.delta });
  else if (event.type === "agent_start") send({ type: "status", status: "working" });
  else if (event.type === "agent_end") send({ type: "status", status: "idle" });
  else if (event.type === "tool_execution_start") send({ type: "status", status: "tool", detail: event.toolName });
});

const app = express();
if (!dev) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  app.use(express.static(path.resolve(here, "../client")));
  app.get("/{*splat}", (_req, res) => res.sendFile(path.resolve(here, "../client/index.html")));
}
const server = createServer(app); const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  clients.add(ws);
  send({ type: "ready", cwd, model: session.model ? `${session.model.provider}/${session.model.id}` : undefined, proposals: [...reviewProposals, ...proposals.values()], commits, refs, waitMode, initialTarget: waitMode ? "uncommitted" : "latest" }, ws);
  ws.on("close", () => clients.delete(ws));
  ws.on("message", async (raw) => {
    try {
      const command = JSON.parse(raw.toString());
      if (command.type === "complete_review") {
        const items = [...reviewProposals, ...proposals.values()];
        const submittedStatuses = new Map<string, Proposal["status"]>((command.reviews ?? []).map((review: { id: string; status: Proposal["status"] }) => [review.id, review.status]));
        for (const item of items) { const submitted = submittedStatuses.get(item.id); if (submitted) item.status = submitted; }
        const pending = items.filter(item => item.status === "pending");
        if (pending.length) throw new Error(`未確認のファイルが ${pending.length} 件あります`);
        const result = { decision: items.some(item => item.status === "rejected") ? "changes_requested" : "approved", reviews: items.map(item => ({ id: item.id, path: item.path, status: item.status, feedback: item.feedback })), comments: command.comments ?? [], feedback: command.feedback ?? {} };
        console.log(`DIFFAI_REVIEW_RESULT=${JSON.stringify(result)}`);
        if (waitingNotice) clearInterval(waitingNotice);
        setTimeout(() => send({ type: "status", status: "completed", detail: result.decision }), 350);
        if (waitMode) setTimeout(() => { for (const client of clients) client.close(); session.dispose(); server.close(() => process.exit(0)); }, 2_000);
      } else if (command.type === "load_review") {
        const loaded = await loadGitReview(command.target, command.compareWith);
        send({ type: "review_loaded", ...loaded });
      } else if (command.type === "prompt") {
        send({ type: "status", status: "working" });
        await session.prompt(command.message, session.isStreaming ? { streamingBehavior: "steer" } : undefined);
      } else if (command.type === "abort") await session.abort();
      else if (command.type === "review") {
        const proposal = proposals.get(command.id) ?? reviewProposals.find(item => item.id === command.id); if (!proposal) throw new Error("提案が見つかりません");
        proposal.feedback = command.feedback;
        if (command.decision === "approve") {
          if (!proposal.reviewOnly) {
            const file = safePath(proposal.path); const current = await readOrEmpty(file);
            if (current !== proposal.before) throw new Error(`${proposal.path} はレビュー開始後に変更されています`);
            await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, proposal.after, "utf8");
          }
          proposal.status = "approved";
        } else proposal.status = "rejected";
        send({ type: "proposal_updated", proposal });
        if (command.feedback && !waitMode) {
          const msg = `Review feedback for proposal ${proposal.id} (${proposal.path}, ${proposal.status}): ${command.feedback}`;
          if (session.isStreaming) await session.steer(msg); else await session.prompt(msg);
        }
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
