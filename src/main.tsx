import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { diffArrays } from "diff";
import type { GitCommit, Proposal, ServerEvent } from "./types";
import "./style.css";

type Side = "old" | "new";
type LineComment = { proposalId: string; side: Side; line: number; body: string };
type DiffRow = { kind: "same" | "changed"; left?: string; right?: string; leftNo?: number; rightNo?: number };

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
function Diff({ proposal, comments, onComment }: { proposal: Proposal; comments: LineComment[]; onComment: (side: Side, line: number) => void }) {
  const rows = useMemo(() => buildRows(proposal.before, proposal.after), [proposal.before, proposal.after]);
  return <div className="diff">{rows.map((row, i) => {
    const rowComments = comments.filter(c => c.proposalId === proposal.id && ((c.side === "old" && c.line === row.leftNo) || (c.side === "new" && c.line === row.rightNo)));
    return <React.Fragment key={i}><div className={`diff-row ${row.kind}`}>
      <span className="num">{row.leftNo && <button title={`旧 ${row.leftNo}行にコメント`} onClick={() => onComment("old", row.leftNo!)}>＋</button>}{row.leftNo}</span><pre className={row.kind === "changed" && row.leftNo ? "removed" : ""}>{row.left ?? " "}</pre>
      <span className="num">{row.rightNo && <button title={`新 ${row.rightNo}行にコメント`} onClick={() => onComment("new", row.rightNo!)}>＋</button>}{row.rightNo}</span><pre className={row.kind === "changed" && row.rightNo ? "added" : ""}>{row.right ?? " "}</pre>
    </div>{rowComments.map((comment, j) => <div className="line-comment" key={j}><b>{comment.side === "old" ? "旧" : "新"} {comment.line}行</b>{comment.body}</div>)}</React.Fragment>;
  })}</div>;
}
function App() {
  const [proposals, setProposals] = useState<Proposal[]>([]), [selected, setSelected] = useState<string>();
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]), [input, setInput] = useState("");
  const [cwd, setCwd] = useState("接続中…"), [status, setStatus] = useState("connecting"), [error, setError] = useState("");
  const [commits, setCommits] = useState<GitCommit[]>([]), [reviewTarget, setReviewTarget] = useState("latest");
  const [comments, setComments] = useState<LineComment[]>([]), [commenting, setCommenting] = useState<{ side: Side; line: number }>();
  const [commentBody, setCommentBody] = useState("");
  const ws = useRef<WebSocket | undefined>(undefined); const assistant = useRef("");
  useEffect(() => { const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`); ws.current = socket;
    socket.onmessage = e => { const ev = JSON.parse(e.data) as ServerEvent;
      if (ev.type === "ready") { setCwd(ev.cwd); setCommits(ev.commits); setProposals(ev.proposals); setSelected(ev.proposals[0]?.id); }
      else if (ev.type === "review_loaded") { setProposals(ev.proposals); setSelected(ev.proposals[0]?.id); setStatus(`review: ${ev.label}`); }
      else if (ev.type === "proposal") { setProposals(p => [...p, ev.proposal]); setSelected(ev.proposal.id); }
      else if (ev.type === "proposal_updated") setProposals(p => p.map(x => x.id === ev.proposal.id ? ev.proposal : x));
      else if (ev.type === "status") { setStatus(ev.detail ? `${ev.status}: ${ev.detail}` : ev.status); if (ev.status === "idle" && assistant.current) { setMessages(m => [...m, { role: "assistant", text: assistant.current }]); assistant.current = ""; } }
      else if (ev.type === "text_delta") { assistant.current += ev.delta; setStatus("streaming"); }
      else if (ev.type === "error") setError(ev.message);
    }; return () => socket.close(); }, []);
  const current = proposals.find(p => p.id === selected);
  const sendPrompt = () => { if (!input.trim()) return; ws.current?.send(JSON.stringify({ type: "prompt", message: input })); setMessages(m => [...m, { role: "user", text: input }]); setInput(""); };
  const review = (decision: string) => { if (!current) return; const general = (document.querySelector("#feedback") as HTMLTextAreaElement).value.trim(); const lines = comments.filter(c => c.proposalId === current.id).map(c => `${current.path}:${c.side === "old" ? "旧" : "新"}L${c.line}\n${c.body}`).join("\n\n"); const feedback = [general, lines].filter(Boolean).join("\n\n"); ws.current?.send(JSON.stringify({ type: "review", id: current.id, decision, feedback })); };
  const loadReview = (target = reviewTarget) => { setReviewTarget(target); ws.current?.send(JSON.stringify({ type: "load_review", target })); };
  const saveComment = () => { if (!current || !commenting || !commentBody.trim()) return; setComments(c => [...c, { proposalId: current.id, ...commenting, body: commentBody.trim() }]); setCommenting(undefined); setCommentBody(""); };
  return <main><header><b>diff<span>ai</span></b><div className="workspace">{cwd}</div><div className={`status ${status}`}>● {status}</div></header>
    {error && <div className="error" onClick={() => setError("")}>{error} ×</div>}
    <section className="layout"><aside><h3>レビュー対象</h3><div className="target"><select value={reviewTarget} onChange={e => loadReview(e.target.value)}><option value="latest">最新コミット (HEAD)</option><option value="uncommitted">未コミットすべて</option><option value="staged">ステージ済み</option><option value="working">未ステージ</option><optgroup label="最近のコミット">{commits.map(c => <option value={c.hash} key={c.hash}>{c.shortHash} {c.subject}</option>)}</optgroup></select><button onClick={() => loadReview()}>再読込</button></div><h3>変更ファイル <small>{proposals.length}</small></h3>{proposals.map(p => <button className={selected === p.id ? "active" : ""} onClick={() => setSelected(p.id)} key={p.id}><i className={p.status}/><span>{p.path}<small>{p.summary}</small></span></button>)}{!proposals.length && <p className="empty">変更はありません</p>}</aside>
      <article>{current ? <><div className="title"><div><h2>{current.path}</h2><p>{current.summary}</p></div><em className={current.status}>{current.status}</em></div><Diff proposal={current} comments={comments} onComment={(side, line) => { setCommenting({ side, line }); setCommentBody(""); }}/>{commenting && <div className="comment-editor"><b>{commenting.side === "old" ? "旧" : "新"} {commenting.line}行へのコメント</b><textarea autoFocus value={commentBody} onChange={e => setCommentBody(e.target.value)} placeholder="この行へのフィードバック"/><button onClick={() => setCommenting(undefined)}>キャンセル</button><button onClick={saveComment}>追加</button></div>}<div className="review"><textarea id="feedback" placeholder="全体へのフィードバック（任意）"/><button className="reject" disabled={current.status !== "pending"} onClick={() => review("reject")}>{current.reviewOnly ? "修正を依頼" : "却下・再修正"}</button><button className="approve" disabled={current.status !== "pending"} onClick={() => review("approve")}>{current.reviewOnly ? "レビュー済み" : "承認して適用"}</button></div></> : <div className="welcome"><h1>Review AI changes,<br/>before they happen.</h1><p>レビュー対象を選ぶか、Piに作業を依頼してください。</p></div>}</article>
      <aside className="chat"><h3>Pi</h3><div className="messages">{messages.map((m, i) => <div className={m.role} key={i}>{m.text}</div>)}{status === "streaming" && <div className="assistant live">{assistant.current}</div>}</div><div className="composer"><textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendPrompt(); } }} placeholder="変更内容を依頼…"/><button onClick={sendPrompt}>↑</button></div></aside></section></main>;
}
createRoot(document.getElementById("root")!).render(<App/>);
