import type { Proposal, ReviewReply } from "../types";
import type { LineComment } from "../reviewTypes";

type Props = {
  proposals: Proposal[];
  comments: LineComment[];
  replies: ReviewReply[];
  feedback: Record<string, string>;
  onSelectProposal: (proposalId: string) => void;
  onReturnWithReview: () => void;
};

/** 常に開いている、ファイル単位のフィードバックと行コメントの一覧。 */
export function ReviewSummary({ proposals, comments, replies, feedback, onSelectProposal, onReturnWithReview }: Props) {
  const proposalIds = new Set(proposals.map(proposal => proposal.id));
  const activeComments = comments.filter(comment => proposalIds.has(comment.proposalId));
  const feedbackCount = proposals.filter(proposal => Boolean(feedback[proposal.id]?.trim())).length;
  const replyByCommentId = new Map(replies.map(reply => [reply.commentId, reply]));
  const replyOnlyCount = proposals.filter(proposal => !feedback[proposal.id]?.trim() && replyByCommentId.has(`feedback:${proposal.id}`)).length;
  const itemCount = activeComments.length + feedbackCount + replyOnlyCount;

  return <details className="review-summary" open>
    <summary onClick={event => event.preventDefault()}>レビューコメント一覧 ({itemCount})</summary>
    <div className="review-summary-body">
      {itemCount === 0 && <p className="summary-empty">まだコメントはありません。Diffの行番号をクリックして追加できます。</p>}
      {proposals.map(proposal => {
        const proposalComments = activeComments.filter(comment => comment.proposalId === proposal.id);
        const fileFeedback = feedback[proposal.id]?.trim() ? feedback[proposal.id] : "";
        const fileReply = replyByCommentId.get(`feedback:${proposal.id}`);
        if (!fileFeedback && proposalComments.length === 0 && !fileReply) return null;

        return <section key={proposal.id} className="summary-file">
          <button className="summary-file-button" onClick={() => onSelectProposal(proposal.id)}>
            <b>{proposal.path}</b><span>このファイルを表示</span>
          </button>
          {fileFeedback && <button className="summary-item" onClick={() => onSelectProposal(proposal.id)}>
            <strong>ファイル全体</strong><p>{fileFeedback}</p>
            {fileReply && <em className={`reply ${fileReply.status}`}>返信: {fileReply.body}</em>}
          </button>}
          {fileReply && !fileFeedback && <button className="summary-item" onClick={() => onSelectProposal(proposal.id)}>
            <strong>ファイル全体への返信</strong><p>返信を受信しました</p>
            <em className={`reply ${fileReply.status}`}>返信: {fileReply.body}</em>
          </button>}
          {proposalComments.map(comment => {
            const reply = replyByCommentId.get(comment.id);
            return <button className="summary-item" key={comment.id} onClick={() => onSelectProposal(proposal.id)}>
              <strong>{comment.side === "old" ? "旧" : "新"} {comment.line}行</strong><p>{comment.body}</p>
              {reply && <em className={`reply ${reply.status}`}>返信: {reply.body}</em>}
            </button>;
          })}
        </section>;
      })}
      <button className="return-review" onClick={onReturnWithReview}>レビュー完了時に返す</button>
    </div>
  </details>;
}
