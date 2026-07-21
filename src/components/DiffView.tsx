import React, { useEffect, useMemo, useState } from "react";
import type { Proposal, ReviewReply } from "../types";
import type { LineComment, Side } from "../reviewTypes";
import { buildRows } from "../diffRows";
import { highlightLines } from "../syntaxHighlight";

type Props = {
  proposal: Proposal;
  comments: LineComment[];
  replies: ReviewReply[];
  onComment: (side: Side, line: number) => void;
  onDelete: (comment: LineComment) => void;
};

export function DiffView({ proposal, comments, replies, onComment, onDelete }: Props) {
  const rows = useMemo(() => buildRows(proposal.before, proposal.after), [proposal.before, proposal.after]);
  const [highlighted, setHighlighted] = useState<{ old?: React.ReactNode[][]; new?: React.ReactNode[][] }>({});
  useEffect(() => {
    let active = true;
    Promise.all([highlightLines(proposal.before, proposal.path), highlightLines(proposal.after, proposal.path)])
      .then(([oldLines, newLines]) => { if (active) setHighlighted({ old: oldLines, new: newLines }); });
    return () => { active = false; };
  }, [proposal.before, proposal.after, proposal.path]);
  const replyByCommentId = useMemo(() => new Map(replies.map(reply => [reply.commentId, reply])), [replies]);

  const currentLine = (comment: LineComment) =>
    rows.find(row => comment.side === "old" ? row.leftNo === comment.line : row.rightNo === comment.line)?.[
      comment.side === "old" ? "left" : "right"
    ];

  const renderComment = (comment: LineComment, key: React.Key) => {
    const reply = replyByCommentId.get(comment.id);
    const line = currentLine(comment);
    const outdated = comment.quote !== undefined && line !== comment.quote;

    return <div className={`line-comment ${outdated ? "outdated" : ""}`} key={key}>
      <b>{comment.side === "old" ? "旧" : "新"} {comment.line}行{outdated && <small>outdated</small>}</b>
      <span>
        <code>{comment.quote ?? line ?? ""}</code>
        {comment.body}
        {reply && <em className={`reply ${reply.status}`}>返信: {reply.body}</em>}
      </span>
      <button title="コメントを削除" onClick={() => onDelete(comment)}>×</button>
    </div>;
  };

  const orphanComments = comments.filter(comment => comment.proposalId === proposal.id && currentLine(comment) === undefined);

  return <div className="diff">
    {orphanComments.map(comment => renderComment(comment, comment.id))}
    {rows.map((row, i) => {
      const rowComments = comments.filter(c => c.proposalId === proposal.id && ((c.side === "old" && c.line === row.leftNo) || (c.side === "new" && c.line === row.rightNo)));
      const left = row.leftNo ? highlighted.old?.[row.leftNo - 1] ?? row.left : row.left;
      const right = row.rightNo ? highlighted.new?.[row.rightNo - 1] ?? row.right : row.right;
      return <React.Fragment key={i}>
        <div className={`diff-row ${row.kind}`}>
          <span className="num">{row.leftNo && <button title={`旧 ${row.leftNo}行にコメント`} onClick={() => onComment("old", row.leftNo!)}>＋</button>}{row.leftNo}</span>
          <pre className={row.kind === "changed" && row.leftNo ? "removed" : ""}>{left ?? " "}</pre>
          <span className="num">{row.rightNo && <button title={`新 ${row.rightNo}行にコメント`} onClick={() => onComment("new", row.rightNo!)}>＋</button>}{row.rightNo}</span>
          <pre className={row.kind === "changed" && row.rightNo ? "added" : ""}>{right ?? " "}</pre>
        </div>
        {rowComments.map((comment, j) => renderComment(comment, `${i}:${j}`))}
      </React.Fragment>;
    })}
  </div>;
}
