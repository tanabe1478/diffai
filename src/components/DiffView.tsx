import { useMemo, useState } from "react";
import { parseDiffFromFile, registerCustomLanguage, type DiffLineAnnotation, type LanguageRegistration } from "@pierre/diffs";
import { FileDiff, type FileDiffProps } from "@pierre/diffs/react";
import type { Proposal, ReviewReply } from "../types";
import type { LineComment, Side } from "../reviewTypes";

type Props = {
  proposal: Proposal;
  comments: LineComment[];
  replies: ReviewReply[];
  onComment: (side: Side, line: number) => void;
  onDelete: (comment: LineComment) => void;
};

type CommentAnnotation = DiffLineAnnotation<LineComment>;
type DiffOptions = NonNullable<FileDiffProps<LineComment>["options"]>;

registerCustomLanguage("tla", async () => {
  const { default: grammar } = await import("@wooorm/starry-night/source.tla");
  return { default: [{ ...grammar, name: "tla" } as LanguageRegistration] };
}, ["tla"]);

registerCustomLanguage("moonbit", async () => {
  const { default: grammar } = await import("@wooorm/starry-night/source.moonbit");
  return { default: [{ ...grammar, name: "moonbit" } as LanguageRegistration] };
}, ["mbt"]);

function languageForPath(path: string) {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith(".tla")) return "tla";
  if (lowerPath.endsWith(".mbt")) return "moonbit";
  return undefined;
}

export function DiffView({ proposal, comments, replies, onComment, onDelete }: Props) {
  const [diffStyle, setDiffStyle] = useState<"split" | "unified">(() => window.matchMedia("(max-width: 900px)").matches ? "unified" : "split");
  const [expandUnchanged, setExpandUnchanged] = useState(false);
  const fileDiff = useMemo(() => {
    const lang = languageForPath(proposal.path);
    return parseDiffFromFile(
      { name: proposal.path, contents: proposal.before, lang },
      { name: proposal.path, contents: proposal.after, lang },
    );
  }, [proposal.id, proposal.path, proposal.before, proposal.after]);

  const fileComments = useMemo(() => comments.filter(comment => comment.proposalId === proposal.id), [comments, proposal.id]);
  const annotations = useMemo<CommentAnnotation[]>(() => fileComments
    .filter(comment => comment.line > 0 && comment.line <= (comment.side === "old" ? proposal.before : proposal.after).split("\n").length)
    .map(comment => ({
      side: comment.side === "old" ? "deletions" : "additions",
      lineNumber: comment.line,
      metadata: comment,
    })), [fileComments, proposal.before, proposal.after]);
  const annotatedIds = new Set(annotations.map(annotation => annotation.metadata.id));
  const orphanComments = fileComments.filter(comment => !annotatedIds.has(comment.id));
  const replyByCommentId = useMemo(() => new Map(replies.map(reply => [reply.commentId, reply])), [replies]);

  const options = useMemo<DiffOptions>(() => ({
    diffStyle,
    diffIndicators: "bars",
    disableFileHeader: true,
    expandUnchanged,
    collapsedContextThreshold: 6,
    expansionLineCount: 40,
    hunkSeparators: "line-info",
    lineDiffType: "word-alt",
    lineHoverHighlight: "both",
    enableGutterUtility: true,
    onGutterUtilityClick: range => onComment(range.side === "deletions" ? "old" : "new", range.start),
    overflow: "scroll",
    theme: { light: "pierre-light", dark: "pierre-dark" },
    themeType: "system",
    onLineNumberClick: ({ annotationSide, lineNumber }) => onComment(annotationSide === "deletions" ? "old" : "new", lineNumber),
  }), [diffStyle, expandUnchanged, onComment]);

  const renderComment = (comment: LineComment) => {
    const source = comment.side === "old" ? proposal.before : proposal.after;
    const line = source.split("\n")[comment.line - 1];
    const outdated = comment.quote !== undefined && line !== comment.quote;
    const reply = replyByCommentId.get(comment.id);
    return <div className={`line-comment ${outdated ? "outdated" : ""}`} data-comment-id={comment.id}>
      <b>{comment.side === "old" ? "旧" : "新"} {comment.line}行{outdated && <small>outdated</small>}</b>
      <span>
        <code>{comment.quote ?? line ?? ""}</code>
        {comment.body}
        {reply && <em className={`reply ${reply.status}`}>返信: {reply.body}</em>}
      </span>
      <button title="コメントを削除" onClick={() => onDelete(comment)}>×</button>
    </div>;
  };

  return <div className="diff pierre-diff">
    <div className="diff-toolbar" aria-label="Diff表示設定">
      <button className={diffStyle === "split" ? "active" : ""} onClick={() => setDiffStyle("split")}>左右</button>
      <button className={diffStyle === "unified" ? "active" : ""} onClick={() => setDiffStyle("unified")}>一列</button>
      <button onClick={() => setExpandUnchanged(value => !value)}>{expandUnchanged ? "変更周辺のみ" : "全行を表示"}</button>
    </div>
    {orphanComments.map(comment => <div key={comment.id}>{renderComment(comment)}</div>)}
    <FileDiff<LineComment>
      fileDiff={fileDiff}
      lineAnnotations={annotations}
      options={options}
      renderAnnotation={annotation => renderComment(annotation.metadata)}
      className="diffai-file-diff"
    />
  </div>;
}
