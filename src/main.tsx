import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GitCommit, GitRef, Proposal, ReviewReply, ServerEvent } from "./types";
import type { LineComment } from "./reviewTypes";

type SavedStatus = { status: Proposal["status"]; before: string; after: string };
import { buildFileTree } from "./fileTree";
import { FileTree } from "./components/FileTree";
import { ReviewPane } from "./components/ReviewPane";
import "@wooorm/starry-night/style/dark";
import "./style.css";

function App() {
  const [proposals, setProposals] = useState<Proposal[]>([]), [selected, setSelected] = useState<string>();
  const [cwd, setCwd] = useState("接続中…"), [status, setStatus] = useState("connecting"), [error, setError] = useState(""), [waitMode, setWaitMode] = useState(false);
  const [completion, setCompletion] = useState<"idle" | "sending" | "completed">("idle");
  const [completionDecision, setCompletionDecision] = useState<"approved" | "changes_requested">();
  const [commits, setCommits] = useState<GitCommit[]>([]), [refs, setRefs] = useState<GitRef[]>([]), [reviewTarget, setReviewTarget] = useState("latest");
  const [compareBase, setCompareBase] = useState("HEAD~1"), [compareHead, setCompareHead] = useState("HEAD");
  const [savedStatuses, setSavedStatuses] = useState<Record<string, SavedStatus>>({});
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const [replies, setReplies] = useState<ReviewReply[]>([]), [reviewStorageKey, setReviewStorageKey] = useState("");
  const [comments, setComments] = useState<LineComment[]>([]), [commenting, setCommenting] = useState<Pick<LineComment, "side" | "line">>();
  const [commentBody, setCommentBody] = useState(""), [feedback, setFeedback] = useState<Record<string, string>>({});
  const hydrated = useRef(false);
  const ws = useRef<WebSocket | undefined>(undefined);
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
        setComments((saved.comments ?? []).map((comment: LineComment & { id?: string }) => ({ ...comment, id: comment.id ?? crypto.randomUUID() })));
        setFeedback(saved.feedback ?? {}); setSavedStatuses(saved.statuses ?? {});
      } catch { setComments([]); setFeedback({}); setSavedStatuses({}); }
      hydrated.current = true;
    };
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`); ws.current = socket;
    socket.onmessage = e => { const ev = JSON.parse(e.data) as ServerEvent;
      if (ev.type === "ready") { setCwd(ev.cwd); setCommits(ev.commits); setRefs(ev.refs); setWaitMode(ev.waitMode); setReviewTarget(ev.initialTarget); setProposals(ev.proposals); setSelected(ev.proposals[0]?.id); setReplies(ev.replies); hydrateReview(ev.cwd, ev.reviewSessionId); }
      else if (ev.type === "review_loaded") { setProposals(ev.proposals); setSelected(ev.proposals[0]?.id); setReplies(ev.replies); setCompletion("idle"); setCompletionDecision(undefined); setStatus(`review: ${ev.label}`); hydrateReview(ev.cwd, ev.reviewSessionId); }
      else if (ev.type === "proposal") { setProposals(p => [...p, ev.proposal]); setSelected(ev.proposal.id); }
      else if (ev.type === "proposal_updated") { setProposals(p => p.map(x => x.id === ev.proposal.id ? ev.proposal : x)); setSavedStatuses(items => { const next = { ...items }; if (ev.proposal.status === "rejected") next[ev.proposal.id] = { status: "rejected", before: ev.proposal.before, after: ev.proposal.after }; else delete next[ev.proposal.id]; return next; }); }
      else if (ev.type === "status") { setStatus(ev.detail ? `${ev.status}: ${ev.detail}` : ev.status); if (ev.status === "completed") { setCompletion("completed"); if (ev.detail === "approved" || ev.detail === "changes_requested") setCompletionDecision(ev.detail); } }
      else if (ev.type === "text_delta") { setStatus("streaming"); }
      else if (ev.type === "error") { setError(ev.message); setCompletion("idle"); }
    }; return () => socket.close();
  }, []);
  useEffect(() => { if (!hydrated.current || !reviewStorageKey) return; localStorage.setItem(reviewStorageKey, JSON.stringify({ comments, feedback, statuses: savedStatuses })); }, [comments, feedback, savedStatuses, reviewStorageKey]);
  const statusOf = (proposal: Proposal) => {
    const saved = savedStatuses[proposal.id];
    if (saved?.status === "rejected" && saved.before === proposal.before && saved.after === proposal.after) return saved.status;
    return proposal.status === "rejected" ? "rejected" : "pending";
  };
  const fileTree = useMemo(() => buildFileTree(proposals), [proposals]);
  const toggleDir = (path: string) => setCollapsedDirs(items => { const next = new Set(items); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  const current = proposals.find(p => p.id === selected);
  const currentFileReply = current ? replies.find(reply => reply.commentId === `feedback:${current.id}`) : undefined;
  const review = (decision: string) => { if (!current) return; const general = (feedback[current.id] ?? "").trim(); const lines = comments.filter(c => c.proposalId === current.id).map(c => `${current.path}:${c.side === "old" ? "旧" : "新"}L${c.line}\n${c.body}`).join("\n\n"); const reviewFeedback = [general, lines].filter(Boolean).join("\n\n"); ws.current?.send(JSON.stringify({ type: "review", id: current.id, decision, feedback: reviewFeedback })); };
  const selectReviewTarget = (target: string) => { if (target === "compare") setReviewTarget(target); else loadReview(target); };
  const loadReview = (target = reviewTarget) => { setReviewTarget(target); ws.current?.send(JSON.stringify({ type: "load_review", target, compareWith: target === "compare" ? `${compareBase}\x1f${compareHead}` : undefined })); };
  const completeReview = () => { if (!proposals.length || completion !== "idle") return; const completed = Object.fromEntries(proposals.map(proposal => [proposal.id, statusOf(proposal) === "rejected" ? "rejected" as const : "approved" as const])); const rejected = Object.fromEntries(proposals.filter(proposal => completed[proposal.id] === "rejected").map(proposal => [proposal.id, { status: "rejected" as const, before: proposal.before, after: proposal.after }])); setSavedStatuses(items => ({ ...items, ...rejected })); setCompletionDecision(Object.values(completed).some(status => status === "rejected") ? "changes_requested" : "approved"); setCompletion("sending"); ws.current?.send(JSON.stringify({ type: "complete_review", comments, feedback, reviews: proposals.map(proposal => ({ id: proposal.id, status: completed[proposal.id] })) })); };
  const sendAllFeedback = () => { if (!comments.length && !Object.values(feedback).some(Boolean)) { setError("送信するレビューコメントがありません"); return; } setError("レビューコメントは「レビューを完了」で呼び出し元へ返されます"); };
  const saveComment = () => {
    if (!current || !commenting || !commentBody.trim()) return;
    const source = commenting.side === "old" ? current.before : current.after;
    const quote = source.split("\n")[commenting.line - 1] ?? "";
    setComments(c => [...c, { id: crypto.randomUUID(), proposalId: current.id, ...commenting, quote, body: commentBody.trim() }]);
    setCommenting(undefined); setCommentBody("");
  };
  return <main><header><b>diff<span>ai</span></b><div className="workspace">{cwd}</div><div className={`status ${status}`}>● {status}</div></header>
    {waitMode && completion === "idle" && <div className="waiting-banner"><b>レビュー完了待ちです</b><span>問題なければ左側の「レビューを完了」で一括承認できます。</span></div>}{completion === "sending" && <div className="completion-overlay"><div className="spinner"/><b>レビュー結果を送信中…</b><span>このままお待ちください</span></div>}{completion === "completed" && <div className="completion-overlay done"><div className="check">✓</div>{completionDecision === "changes_requested" ? <><b>修正依頼を呼び出し元へ送信しました</b><span>このタブのままお待ちください。呼び出し元が修正後にdiffaiを再実行すると、再レビュー画面へ切り替わります。</span></> : <><b>レビューが完了しました</b><span>変更は承認されました。このタブは閉じて構いません。</span></>}</div>}
    {error && <div className="error" onClick={() => setError("")}>{error} ×</div>}
    <section className="layout"><aside><h3>レビュー対象</h3><div className="target"><select value={reviewTarget} onChange={e => selectReviewTarget(e.target.value)}><option value="latest">最新コミット (HEAD)</option><option value="uncommitted">未コミットすべて</option><option value="staged">ステージ済み</option><option value="working">未ステージ</option><option value="compare">ブランチ・コミット間比較</option><optgroup label="最近のコミット">{commits.map(c => <option value={c.hash} key={c.hash}>{c.shortHash} {c.subject}</option>)}</optgroup></select><button onClick={() => loadReview()}>読込</button></div>{reviewTarget === "compare" && <div className="compare"><input list="git-refs" value={compareBase} onChange={e => setCompareBase(e.target.value)} aria-label="比較元"/><span>→</span><input list="git-refs" value={compareHead} onChange={e => setCompareHead(e.target.value)} aria-label="比較先"/><button onClick={() => loadReview("compare")}>比較</button><datalist id="git-refs">{refs.map(ref => <option value={ref.name} key={ref.name}/>)}</datalist></div>}<div className="progress"><button className="complete" onClick={completeReview} disabled={!proposals.length || completion !== "idle"}>{completion === "sending" ? "送信中…" : completion === "completed" ? "送信しました" : "レビューを完了"}</button></div><h3>変更ファイル <small>{proposals.length}</small></h3><FileTree nodes={fileTree} selected={selected} statusOf={statusOf} onSelect={setSelected} collapsed={collapsedDirs} onToggle={toggleDir}/>{!proposals.length && <p className="empty">該当する変更はありません</p>}</aside>
      <ReviewPane
        proposals={proposals}
        current={current}
        statusOf={statusOf}
        comments={comments}
        replies={replies}
        feedback={feedback}
        commenting={commenting}
        commentBody={commentBody}
        onReturnWithReview={sendAllFeedback}
        onStartComment={(side, line) => { setCommenting({ side, line }); setCommentBody(""); }}
        onDeleteComment={comment => setComments(items => items.filter(item => item !== comment))}
        onCancelComment={() => setCommenting(undefined)}
        onChangeCommentBody={setCommentBody}
        onSaveComment={saveComment}
        onChangeFeedback={(proposalId, body) => setFeedback(items => ({ ...items, [proposalId]: body }))}
        onReview={review}
      /></section></main>;
}
createRoot(document.getElementById("root")!).render(<App/>);
