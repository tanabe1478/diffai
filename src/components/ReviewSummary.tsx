import type { Proposal } from "../types";
import type { LineComment } from "../reviewTypes";

type Props = {
  proposals: Proposal[];
  comments: LineComment[];
  feedback: Record<string, string>;
  onReturnWithReview: () => void;
};

export function ReviewSummary({ proposals, comments, feedback, onReturnWithReview }: Props) {
  const feedbackCount = Object.values(feedback).filter(Boolean).length;
  if (comments.length === 0 && feedbackCount === 0) return null;

  return <details className="review-summary">
    <summary>レビューコメント一覧 ({comments.length + feedbackCount})</summary>
    <div>
      {proposals.map(proposal => {
        const proposalComments = comments.filter(comment => comment.proposalId === proposal.id);
        const fileFeedback = feedback[proposal.id];
        if (!fileFeedback && proposalComments.length === 0) return null;

        return <section key={proposal.id}>
          <b>{proposal.path}</b>
          {fileFeedback && <p>{fileFeedback}</p>}
          {proposalComments.map(comment => <p key={comment.id}>L{comment.line}: {comment.body}</p>)}
        </section>;
      })}
      <button onClick={onReturnWithReview}>レビュー完了時に返す</button>
    </div>
  </details>;
}
