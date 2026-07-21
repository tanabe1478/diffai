import type { Proposal, ReviewReply } from "../types";
import type { LineComment, Side } from "../reviewTypes";
import { DiffView } from "./DiffView";
import { ReviewSummary } from "./ReviewSummary";

type Props = {
  proposals: Proposal[];
  current?: Proposal;
  statusOf: (proposal: Proposal) => Proposal["status"];
  comments: LineComment[];
  replies: ReviewReply[];
  feedback: Record<string, string>;
  commenting?: Pick<LineComment, "side" | "line">;
  commentBody: string;
  onReturnWithReview: () => void;
  onStartComment: (side: Side, line: number) => void;
  onDeleteComment: (comment: LineComment) => void;
  onCancelComment: () => void;
  onChangeCommentBody: (body: string) => void;
  onSaveComment: () => void;
  onChangeFeedback: (proposalId: string, body: string) => void;
  onReview: (decision: string) => void;
};

export function ReviewPane({
  proposals,
  current,
  statusOf,
  comments,
  replies,
  feedback,
  commenting,
  commentBody,
  onReturnWithReview,
  onStartComment,
  onDeleteComment,
  onCancelComment,
  onChangeCommentBody,
  onSaveComment,
  onChangeFeedback,
  onReview,
}: Props) {
  const currentFileReply = current ? replies.find(reply => reply.commentId === `feedback:${current.id}`) : undefined;

  return <article>
    <ReviewSummary proposals={proposals} comments={comments} feedback={feedback} onReturnWithReview={onReturnWithReview}/>
    {current ? <>
      <div className="title">
        <div><h2>{current.path}</h2><p>{current.summary}</p></div>
        <em className={statusOf(current)}>{statusOf(current)}</em>
      </div>
      <DiffView
        proposal={current}
        comments={comments}
        replies={replies}
        onComment={onStartComment}
        onDelete={onDeleteComment}
      />
      {commenting && <div className="comment-editor">
        <b>{commenting.side === "old" ? "旧" : "新"} {commenting.line}行へのコメント</b>
        <textarea autoFocus value={commentBody} onChange={event => onChangeCommentBody(event.target.value)} placeholder="この行へのフィードバック"/>
        <button onClick={onCancelComment}>キャンセル</button>
        <button onClick={onSaveComment}>追加</button>
      </div>}
      <div className="review">
        <div className="feedback-box">
          <textarea
            id="feedback"
            value={feedback[current.id] ?? ""}
            onChange={event => onChangeFeedback(current.id, event.target.value)}
            placeholder="全体へのフィードバック（任意）"
          />
          {currentFileReply && <em className={`reply ${currentFileReply.status}`}>返信: {currentFileReply.body}</em>}
        </div>
        <button className="reject" disabled={statusOf(current) !== "pending"} onClick={() => onReview("reject")}>{current.reviewOnly ? "修正を依頼" : "却下・再修正"}</button>
        {!current.reviewOnly && <button className="approve" disabled={statusOf(current) !== "pending"} onClick={() => onReview("approve")}>承認して適用</button>}
      </div>
    </> : <div className="welcome"><h1>Review AI changes,<br/>before they happen.</h1><p>レビュー対象を選んでください。</p></div>}
  </article>;
}
