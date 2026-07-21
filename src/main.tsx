import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { diffArrays } from "diff";
import type { GitCommit, GitRef, Proposal, ReviewReply, ServerEvent } from "./types";
import { highlightLines } from "./syntaxHighlight";
import "@wooorm/starry-night/style/dark";
import "./style.css";

type Side = "old" | "new";
type LineComment = { id: string; proposalId: string; side: Side; line: number; body: string };
type DiffRow = { kind: "same" | "changed"; left?: string; right?: string; leftNo?: number; rightNo?: number };
type FileTreeNode = { name: string; path: string; children: FileTreeNode[]; proposal?: Proposal };

function buildRows(before: string, after: string): DiffRow[] {
  const changes = diffArrays(before.split("\n"), after.split("\n"));
  const rows: DiffRow[] = []; let oldLine = 1, newLine = 1;
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    if (change.removed && changes[i + 1]?.added) {
      const added = changes[++i]; const count = Math.max(change.value.length, added.value.length);
      for (let j = 0; j < count; j++) rows.push({ kind: "changed", left: change.value[j], right: added.value[j], leftNo: j < change.value.length ? oldLine++ : undefined, rightNo: j < added.value.length ? newLine++ : undefined });
    } else if (change.added) {
      for (const line of change.value) rows.push({ kind: "changed", right: line, rightNo: newLine++ });
    } else if (change.removed) {
      for (const line of change.value) rows.push({ kind: "changed", left: line, leftNo: oldLine++ });
    } else {
      for (const line of change.value) rows.push({ kind: "same", left: line, right: line, leftNo: oldLine++, rightNo: newLine++ });
    }
  }
  return rows;
}
function Diff({ proposal, comments, replies, onComment, onDelete }: { proposal: Proposal; comments: LineComment[]; replies: ReviewReply[]; onComment: (side: Side, line: number) => void; onDelete: (comment: LineComment) => void }) {
  const rows = useMemo(() => buildRows(proposal.before, proposal.after), [proposal.before, proposal.after]);
  const [highlighted, setHighlighted] = useState<{ old?: React.ReactNode[][]; new?: React.ReactNode[][] }>({});
  useEffect(() => {
    let active = true;
    Promise.all([highlightLines(proposal.before, proposal.path), highlightLines(proposal.after, proposal.path)])
      .then(([oldLines, newLines]) => { if (active) setHighlighted({ old: oldLines, new: newLines }); });
    return () => { active = false; };
  }, [proposal.before, proposal.after, proposal.path]);
  return <div className="diff">{rows.map((row, i) => {
    const rowComments = comments.filter(c => c.proposalId === proposal.id && ((c.side === "old" && c.line === row.leftNo) || (c.side === "new" && c.line === row.rightNo)));
    const left = row.leftNo ? highlighted.old?.[row.leftNo - 1] ?? row.left : row.left;
    const right = row.rightNo ? highlighted.new?.[row.rightNo - 1] ?? row.right : row.right;
    return <React.Fragment key={i}><div className={`diff-row ${row.kind}`}>
      <span className="num">{row.leftNo && <button title={`旧 ${row.leftNo}行にコメント`} onClick={() => onComment("old", row.leftNo!)}>＋</button>}{row.leftNo}</span><pre className={row.kind === "changed" && row.leftNo ? "removed" : ""}>{left ?? " "}</pre>
      <span className="num">{row.rightNo && <button title={`新 ${row.rightNo}行にコメント`} onClick={() => onComment("new", row.rightNo!)}>＋</button>}{row.rightNo}</span><pre className={row.kind === "changed" && row.rightNo ? "added" : ""}>{right ?? " "}</pre>
    </div>{rowComments.map(comment => { const reply = replies.find(item => item.commentId === comment.id); return <div className="line-comment" key={comment.id}><b>{comment.side === "old" ? "旧" : "新"} {comment.line}行</b><span>{comment.body}{reply && <small className={`reply ${reply.status}`}>↳ {reply.body}</small>}</span><button title="コメントを削除" onClick={() => onDelete(comment)}>×</button></div>; })}</React.Fragment>;
  })}</div>;
}
function buildFileTree(proposals: Proposal[]): FileTreeNode[] {
  const root: FileTreeNode = { name: "", path: "", children: [] };
  for (const proposal of proposals) {
    let node = root;
    const parts = proposal.path.split("/");
    for (let index = 0; index < parts.length; index++) {
      const name = parts[index]; const nodePath = parts.slice(0, index + 1).join("/");
      let child = node.children.find(item => item.name === name);
      if (!child) { child = { name, path: nodePath, children: [] }; node.children.push(child); }
      if (index === parts.length - 1) child.proposal = proposal;
      node = child;
    }
  }
  const sort = (nodes: FileTreeNode[]): FileTreeNode[] => nodes.sort((a, b) => Number(!!a.proposal) - Number(!!b.proposal) || a.name.localeCompare(b.name)).map(node => ({ ...node, children: sort(node.children) }));
  return sort(root.children);
}
function FileTree({ nodes, selected, statusOf, onSelect, collapsed, onToggle, depth = 0 }: { nodes: FileTreeNode[]; selected?: string; statusOf: (proposal: Proposal) => Proposal["status"]; onSelect: (id: string) => void; collapsed: Set<string>; onToggle: (path: string) => void; depth?: number }) {
  return <div className={depth === 0 ? "file-tree" : "tree-children"}>{nodes.map(node => {
    if (node.proposal) return <button className={`tree-file ${selected === node.proposal.id ? "active" : ""}`} style={{ "--depth": depth } as React.CSSProperties} onClick={() => onSelect(node.proposal!.id)} key={node.path}><i className={statusOf(node.proposal)}/><span>{node.name}<small>{node.proposal.path}</small></span></button>;
    const isCollapsed = collapsed.has(node.path);
    return <div key={node.path}><button className="tree-dir" style={{ "--depth": depth } as React.CSSProperties} onClick={() => onToggle(node.path)} aria-expanded={!isCollapsed}><span>{isCollapsed ? "▸" : "▾"}</span>{node.name}</button>{!isCollapsed && <FileTree nodes={node.children} selected={selected} statusOf={statusOf} onSelect={onSelect} collapsed={collapsed} onToggle={onToggle} depth={depth + 1}/>}</div>;
  })}</div>;
}
function App() {
  const [proposals, setProposals] = useState<Proposal[]>([]), [selected, setSelected] = useState<string>();
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]), [input, setInput] = useState("");
  const [cwd, setCwd] = useState("接続中…"), [status, setStatus] = useState("connecting"), [error, setError] = useState(""), [waitMode, setWaitMode] = useState(false);
  const [completion, setCompletion] = useState<"idle" | "sending" | "completed">("idle");
  const [commits, setCommits] = useState<GitCommit[]>([]), [refs, setRefs] = useState<GitRef[]>([]), [reviewTarget, setReviewTarget] = useState("latest");
  const [compareBase, setCompareBase] = useState("HEAD~1"), [compareHead, setCompareHead] = useState("HEAD");
  const [savedStatuses, setSavedStatuses] = useState<Record<string, Proposal["status"]>>({});
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const [comments, setComments] = useState<LineComment[]>([]), [commenting, setCommenting] = useState<{ side: Side; line: number }>();
  const [commentBody, setCommentBody] = useState(""), [feedback, setFeedback] = useState<Record<string, string>>({});
  const [replies, setReplies] = useState<ReviewReply[]>([]), [reviewStorageKey, setReviewStorageKey] = useState("");
  const hydrated = useRef(false);
  const ws = useRef<WebSocket | undefined>(undefined); const assistant = useRef("");
  useEffect(() => {
    const hydrateReview = (workspace: string, sessionId: string) => {
      hydrated.current = false;
      const key = `diffai:review:${workspace}:${sessionId}`;
      const prefix = `diffai:review:${workspace}:`;
      for (const storedKey of Object.keys(localStorage)) {
        if ((storedKey === `diffai:review:${workspace}` || storedKey.startsWith(prefix)) && storedKey !== key) localStorage.removeItem(storedKey);
      }
      setReviewStorageKey(key);
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
        setComments(saved.comments ?? []); setFeedback(saved.feedback ?? {}); setSavedStatuses(saved.statuses ?? {});
      } catch { setComments([]); setFeedback({}); setSavedStatuses({}); }
      hydrated.current = true;
    };
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`); ws.current = socket;
    socket.onmessage = e => { const ev = JSON.parse(e.data) as ServerEvent;
      if (ev.type === "ready") { setCwd(ev.cwd); setCommits(ev.commits); setRefs(ev.refs); setWaitMode(ev.waitMode); setReviewTarget(ev.initialTarget); setProposals(ev.proposals); setSelected(ev.proposals[0]?.id); setReplies(ev.replies); hydrateReview(ev.cwd, ev.reviewSessionId); }
      else if (ev.type === "review_loaded") { setProposals(ev.proposals); setSelected(ev.proposals[0]?.id); setReplies(ev.replies); setCompletion("idle"); setStatus(`review: ${ev.label}`); hydrateReview(ev.cwd, ev.reviewSessionId); }
      else if (ev.type === "proposal") { setProposals(p => [...p, ev.proposal]); setSelected(ev.proposal.id); }
      else if (ev.type === "proposal_updated") { setProposals(p => p.map(x => x.id === ev.proposal.id ? ev.proposal : x)); setSavedStatuses(items => ({ ...items, [ev.proposal.id]: ev.proposal.status })); }
      else if (ev.type === "status") { setStatus(ev.detail ? `${ev.status}: ${ev.detail}` : ev.status); if (ev.status === "completed") setCompletion("completed"); if (ev.status === "idle" && assistant.current) { setMessages(m => [...m, { role: "assistant", text: assistant.current }]); assistant.current = ""; } }
      else if (ev.type === "text_delta") { assistant.current += ev.delta; setStatus("streaming"); }
      else if (ev.type === "error") { setError(ev.message); setCompletion("idle"); }
    }; return () => socket.close();
  }, []);
  useEffect(() => { if (!hydrated.current || !reviewStorageKey) return; localStorage.setItem(reviewStorageKey, JSON.stringify({ comments, feedback, statuses: savedStatuses })); }, [comments, feedback, savedStatuses, reviewStorageKey]);
  const statusOf = (proposal: Proposal) => savedStatuses[proposal.id] ?? proposal.status;
  const fileTree = useMemo(() => buildFileTree(proposals), [proposals]);
  const toggleDir = (path: string) => setCollapsedDirs(items => { const next = new Set(items); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  const current = proposals.find(p => p.id === selected);
  const currentFileReply = current ? replies.find(reply => reply.commentId === `feedback:${current.id}`) : undefined;
  const sendPrompt = () => { if (!input.trim()) return; ws.current?.send(JSON.stringify({ type: "prompt", message: input })); setMessages(m => [...m, { role: "user", text: input }]); setInput(""); };
  const review = (decision: string) => { if (!current) return; const general = (feedback[current.id] ?? "").trim(); const lines = comments.filter(c => c.proposalId === current.id).map(c => `${current.path}:${c.side === "old" ? "旧" : "新"}L${c.line}\n${c.body}`).join("\n\n"); const reviewFeedback = [general, lines].filter(Boolean).join("\n\n"); ws.current?.send(JSON.stringify({ type: "review", id: current.id, decision, feedback: reviewFeedback })); };
  const loadReview = (target = reviewTarget) => { setReviewTarget(target); ws.current?.send(JSON.stringify({ type: "load_review", target, compareWith: target === "compare" ? `${compareBase}\x1f${compareHead}` : undefined })); };
  const completeReview = () => { if (!proposals.length || completion !== "idle") return; const completed = Object.fromEntries(proposals.map(proposal => [proposal.id, statusOf(proposal) === "rejected" ? "rejected" as const : "approved" as const])); setSavedStatuses(items => ({ ...items, ...completed })); setCompletion("sending"); ws.current?.send(JSON.stringify({ type: "complete_review", comments, feedback, reviews: proposals.map(proposal => ({ id: proposal.id, status: completed[proposal.id] })) })); };
  const sendAllFeedback = () => { const entries = comments.map(c => { const proposal = proposals.find(p => p.id === c.proposalId); return proposal ? `${proposal.path}:${c.side === "old" ? "旧" : "新"}L${c.line}\n${c.body}` : ""; }).filter(Boolean); for (const proposal of proposals) if (feedback[proposal.id]?.trim()) entries.push(`${proposal.path}\n${feedback[proposal.id].trim()}`); if (!entries.length) { setError("送信するレビューコメントがありません"); return; } const message = `以下のレビューコメントをすべて反映し、変更は必ず提案ツールで提示してください。\n\n${entries.join("\n\n")}`; ws.current?.send(JSON.stringify({ type: "prompt", message })); setMessages(items => [...items, { role: "user", text: message }]); };
  const saveComment = () => { if (!current || !commenting || !commentBody.trim()) return; setComments(c => [...c, { id: crypto.randomUUID(), proposalId: current.id, ...commenting, body: commentBody.trim() }]); setCommenting(undefined); setCommentBody(""); };
  return <main><header><b>diff<span>ai</span></b><div className="workspace">{cwd}</div><div className={`status ${status}`}>● {status}</div></header>
    {waitMode && completion === "idle" && <div className="waiting-banner"><b>Piがレビュー完了を待っています</b><span>問題なければ左側の「レビューを完了」で一括承認できます。</span></div>}{completion === "sending" && <div className="completion-overlay"><div className="spinner"/><b>レビュー結果をPiへ送信中…</b><span>このままお待ちください</span></div>}{completion === "completed" && <div className="completion-overlay done"><div className="check">✓</div><b>Piへレビュー結果を送信しました</b><span>このタブのままお待ちください。修正と返信が届くと再レビュー画面へ切り替わります。</span></div>}
    {error && <div className="error" onClick={() => setError("")}>{error} ×</div>}
    <section className="layout"><aside><h3>レビュー対象</h3><div className="target"><select value={reviewTarget} onChange={e => loadReview(e.target.value)}><option value="latest">最新コミット (HEAD)</option><option value="uncommitted">未コミットすべて</option><option value="staged">ステージ済み</option><option value="working">未ステージ</option><option value="compare">ブランチ・コミット間比較</option><optgroup label="最近のコミット">{commits.map(c => <option value={c.hash} key={c.hash}>{c.shortHash} {c.subject}</option>)}</optgroup></select><button onClick={() => loadReview()}>読込</button></div>{reviewTarget === "compare" && <div className="compare"><input list="git-refs" value={compareBase} onChange={e => setCompareBase(e.target.value)} aria-label="比較元"/><span>→</span><input list="git-refs" value={compareHead} onChange={e => setCompareHead(e.target.value)} aria-label="比較先"/><button onClick={() => loadReview("compare")}>比較</button><datalist id="git-refs">{refs.map(ref => <option value={ref.name} key={ref.name}/>)}</datalist></div>}<div className="progress"><button className="complete" onClick={completeReview} disabled={!proposals.length || completion !== "idle"}>{completion === "sending" ? "送信中…" : completion === "completed" ? "送信しました" : "レビューを完了"}</button></div><h3>変更ファイル <small>{proposals.length}</small></h3><FileTree nodes={fileTree} selected={selected} statusOf={statusOf} onSelect={setSelected} collapsed={collapsedDirs} onToggle={toggleDir}/>{!proposals.length && <p className="empty">該当する変更はありません</p>}</aside>
      <article>{(comments.length > 0 || Object.values(feedback).some(Boolean)) && <details className="review-summary"><summary>レビューコメント一覧 ({comments.length + Object.values(feedback).filter(Boolean).length})</summary><div>{proposals.map(proposal => <section key={proposal.id}>{(feedback[proposal.id] || comments.some(c => c.proposalId === proposal.id)) && <><b>{proposal.path}</b>{feedback[proposal.id] && <p>{feedback[proposal.id]}</p>}{comments.filter(c => c.proposalId === proposal.id).map((c, i) => <p key={i}>L{c.line}: {c.body}</p>)}</>}</section>)}<button onClick={sendAllFeedback}>まとめてPiへ修正依頼</button></div></details>}{current ? <><div className="title"><div><h2>{current.path}</h2><p>{current.summary}</p></div><em className={statusOf(current)}>{statusOf(current)}</em></div><Diff proposal={current} comments={comments} replies={replies} onComment={(side, line) => { setCommenting({ side, line }); setCommentBody(""); }} onDelete={comment => setComments(items => items.filter(item => item !== comment))}/>{commenting && <div className="comment-editor"><b>{commenting.side === "old" ? "旧" : "新"} {commenting.line}行へのコメント</b><textarea autoFocus value={commentBody} onChange={e => setCommentBody(e.target.value)} placeholder="この行へのフィードバック"/><button onClick={() => setCommenting(undefined)}>キャンセル</button><button onClick={saveComment}>追加</button></div>}<div className="review"><div className="feedback-box"><textarea id="feedback" value={feedback[current.id] ?? ""} onChange={e => setFeedback(items => ({ ...items, [current.id]: e.target.value }))} placeholder="全体へのフィードバック（任意）"/>{currentFileReply && <small className={`reply ${currentFileReply.status}`}>↳ {currentFileReply.body}</small>}</div><button className="reject" disabled={statusOf(current) !== "pending"} onClick={() => review("reject")}>{current.reviewOnly ? "修正を依頼" : "却下・再修正"}</button>{!current.reviewOnly && <button className="approve" disabled={statusOf(current) !== "pending"} onClick={() => review("approve")}>承認して適用</button>}</div></> : <div className="welcome"><h1>Review AI changes,<br/>before they happen.</h1><p>レビュー対象を選ぶか、Piに作業を依頼してください。</p></div>}</article>
      <aside className="chat"><h3>Pi</h3><div className="messages">{messages.map((m, i) => <div className={m.role} key={i}>{m.text}</div>)}{status === "streaming" && <div className="assistant live">{assistant.current}</div>}</div><div className="composer"><textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendPrompt(); } }} placeholder="変更内容を依頼…"/><button onClick={sendPrompt}>↑</button></div></aside></section></main>;
}
createRoot(document.getElementById("root")!).render(<App/>);
