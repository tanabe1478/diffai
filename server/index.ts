#!/usr/bin/env node
import express from "express";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import open from "open";
import { Type } from "typebox";
import {
  AuthStorage, createAgentSession, DefaultResourceLoader, defineTool,
  ModelRegistry, SessionManager, getAgentDir,
} from "@earendil-works/pi-coding-agent";
import type { Proposal, ServerEvent } from "../src/types.js";

function arg(name: string) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; }
const cwd = path.resolve(arg("cwd") ?? process.cwd());
const port = Number(arg("port") ?? 4317);
const dev = process.argv.includes("--dev");
const proposals = new Map<string, Proposal>();
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
  send({ type: "ready", cwd, model: session.model ? `${session.model.provider}/${session.model.id}` : undefined, proposals: [...proposals.values()] }, ws);
  ws.on("close", () => clients.delete(ws));
  ws.on("message", async (raw) => {
    try {
      const command = JSON.parse(raw.toString());
      if (command.type === "prompt") {
        send({ type: "status", status: "working" });
        await session.prompt(command.message, session.isStreaming ? { streamingBehavior: "steer" } : undefined);
      } else if (command.type === "abort") await session.abort();
      else if (command.type === "review") {
        const proposal = proposals.get(command.id); if (!proposal) throw new Error("提案が見つかりません");
        proposal.feedback = command.feedback;
        if (command.decision === "approve") {
          const file = safePath(proposal.path); const current = await readOrEmpty(file);
          if (current !== proposal.before) throw new Error(`${proposal.path} はレビュー開始後に変更されています`);
          await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, proposal.after, "utf8"); proposal.status = "approved";
        } else proposal.status = "rejected";
        send({ type: "proposal_updated", proposal });
        if (command.feedback) {
          const msg = `Review feedback for proposal ${proposal.id} (${proposal.path}, ${proposal.status}): ${command.feedback}`;
          if (session.isStreaming) await session.steer(msg); else await session.prompt(msg);
        }
      }
    } catch (error) { send({ type: "error", message: error instanceof Error ? error.message : String(error) }, ws); }
  });
});
server.listen(port, "127.0.0.1", async () => {
  const url = `http://127.0.0.1:${dev ? 5173 : port}`;
  console.log(`diffai: ${url}\nworkspace: ${cwd}`);
  if (!process.argv.includes("--no-open")) await open(url);
});
