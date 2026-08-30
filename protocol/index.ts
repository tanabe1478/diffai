/**
 * Pi-independent wire protocol for the diffai CLI and API.
 *
 * This module deliberately has no runtime dependency on Pi, Node, or the UI.
 * Keep the JSON shape closed: accepting an unknown field here would make the
 * stdout contract ambiguous for machine consumers.
 */

export const REVIEW_RESULT_SCHEMA_VERSION = 1 as const;

export type ReviewDecision = "approved" | "changes_requested";
export type ReviewItemStatus = "approved" | "rejected";
export type ReviewCommentSide = "old" | "new";
export type ReplyStatus = "fixed" | "replied" | "wontfix";

export type ReviewItem = {
  id: string;
  path: string;
  status: ReviewItemStatus;
  feedback?: string;
};

export type ReviewComment = {
  id: string;
  proposalId: string;
  side: ReviewCommentSide;
  line: number;
  body: string;
  quote?: string;
};

export type FileFeedback = {
  id: string;
  proposalId: string;
  path: string;
  body: string;
};

export type ReviewFeedback = Record<string, string>;

export type ReplyFormat = {
  replies: Array<{
    commentId: string;
    status: string;
    body: string;
  }>;
};

export type ReviewResult = {
  schemaVersion: typeof REVIEW_RESULT_SCHEMA_VERSION;
  decision: ReviewDecision;
  reviewId: string;
  reviews: ReviewItem[];
  comments: ReviewComment[];
  fileFeedback: FileFeedback[];
  feedback: ReviewFeedback;
  replyFile: string;
  replyFormat: ReplyFormat;
};

export type ReviewResultInput = Omit<ReviewResult, "schemaVersion">;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: JsonRecord, required: readonly string[], optional: readonly string[] = [], label: string): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`${label}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label}.${key} is not allowed`);
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function validateReviewItem(value: unknown, index: number): ReviewItem {
  const label = `reviews[${index}]`;
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  exactKeys(value, ["id", "path", "status"], ["feedback"], label);
  const item: ReviewItem = {
    id: nonEmptyString(value.id, `${label}.id`),
    path: nonEmptyString(value.path, `${label}.path`),
    status: value.status === "approved" || value.status === "rejected" ? value.status : (() => { throw new Error(`${label}.status is invalid`); })(),
  };
  if (value.feedback !== undefined) item.feedback = stringValue(value.feedback, `${label}.feedback`);
  return item;
}

function validateComment(value: unknown, index: number): ReviewComment {
  const label = `comments[${index}]`;
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  exactKeys(value, ["id", "proposalId", "side", "line", "body"], ["quote"], label);
  const side = value.side;
  if (side !== "old" && side !== "new") throw new Error(`${label}.side is invalid`);
  if (typeof value.line !== "number" || !Number.isInteger(value.line) || value.line < 1) throw new Error(`${label}.line must be a positive integer`);
  const line = value.line;
  const comment: ReviewComment = {
    id: nonEmptyString(value.id, `${label}.id`),
    proposalId: nonEmptyString(value.proposalId, `${label}.proposalId`),
    side,
    line,
    body: stringValue(value.body, `${label}.body`),
  };
  if (value.quote !== undefined) comment.quote = stringValue(value.quote, `${label}.quote`);
  return comment;
}

function validateFileFeedback(value: unknown, index: number): FileFeedback {
  const label = `fileFeedback[${index}]`;
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  exactKeys(value, ["id", "proposalId", "path", "body"], [], label);
  return {
    id: nonEmptyString(value.id, `${label}.id`),
    proposalId: nonEmptyString(value.proposalId, `${label}.proposalId`),
    path: nonEmptyString(value.path, `${label}.path`),
    body: stringValue(value.body, `${label}.body`),
  };
}

function validateFeedback(value: unknown): ReviewFeedback {
  if (!isRecord(value)) throw new Error("feedback must be an object");
  const feedback: ReviewFeedback = {};
  for (const [key, item] of Object.entries(value)) {
    if (!key) throw new Error("feedback keys must be non-empty strings");
    feedback[key] = stringValue(item, `feedback.${key}`);
  }
  return feedback;
}

function validateReplyFormat(value: unknown): ReplyFormat {
  if (!isRecord(value)) throw new Error("replyFormat must be an object");
  exactKeys(value, ["replies"], [], "replyFormat");
  if (!Array.isArray(value.replies)) throw new Error("replyFormat.replies must be an array");
  return {
    replies: value.replies.map((item, index) => {
      const label = `replyFormat.replies[${index}]`;
      if (!isRecord(item)) throw new Error(`${label} must be an object`);
      exactKeys(item, ["commentId", "status", "body"], [], label);
      return {
        commentId: stringValue(item.commentId, `${label}.commentId`),
        status: stringValue(item.status, `${label}.status`),
        body: stringValue(item.body, `${label}.body`),
      };
    }),
  };
}

/** Validate and return a freshly shaped, closed ReviewResult v1 value. */
export function validateReviewResult(value: unknown): ReviewResult {
  if (!isRecord(value)) throw new Error("ReviewResult must be an object");
  exactKeys(value, ["schemaVersion", "decision", "reviewId", "reviews", "comments", "fileFeedback", "feedback", "replyFile", "replyFormat"], [], "ReviewResult");
  if (value.schemaVersion !== REVIEW_RESULT_SCHEMA_VERSION) throw new Error("unsupported ReviewResult schemaVersion");
  if (value.decision !== "approved" && value.decision !== "changes_requested") throw new Error("ReviewResult.decision is invalid");
  const result: ReviewResult = {
    schemaVersion: REVIEW_RESULT_SCHEMA_VERSION,
    decision: value.decision,
    reviewId: nonEmptyString(value.reviewId, "ReviewResult.reviewId"),
    reviews: Array.isArray(value.reviews) ? value.reviews.map(validateReviewItem) : (() => { throw new Error("reviews must be an array"); })(),
    comments: Array.isArray(value.comments) ? value.comments.map(validateComment) : (() => { throw new Error("comments must be an array"); })(),
    fileFeedback: Array.isArray(value.fileFeedback) ? value.fileFeedback.map(validateFileFeedback) : (() => { throw new Error("fileFeedback must be an array"); })(),
    feedback: validateFeedback(value.feedback),
    replyFile: nonEmptyString(value.replyFile, "ReviewResult.replyFile"),
    replyFormat: validateReplyFormat(value.replyFormat),
  };
  return result;
}

export function isReviewResult(value: unknown): value is ReviewResult {
  try {
    validateReviewResult(value);
    return true;
  } catch {
    return false;
  }
}

/** Add the protocol version and validate a server-produced result. */
export function buildReviewResult(input: ReviewResultInput): ReviewResult {
  return validateReviewResult({ schemaVersion: REVIEW_RESULT_SCHEMA_VERSION, ...input });
}

/** Serialize exactly one machine-readable stdout record (without a newline). */
export function serializeReviewResult(result: ReviewResult): string {
  const serialized = JSON.stringify(validateReviewResult(result));
  if (serialized.includes("\n") || serialized.includes("\r")) throw new Error("ReviewResult serialization must be one line");
  return serialized;
}

/** Parse one bare JSON line. A single CR is accepted as a CRLF line ending. */
export function parseReviewResultLine(line: string): ReviewResult {
  let payload = line;
  if (payload.endsWith("\r")) payload = payload.slice(0, -1);
  if (!payload || payload.includes("\n") || payload.includes("\r")) throw new Error("ReviewResult must be one JSON line");
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch (error) {
    throw new Error(`invalid ReviewResult JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateReviewResult(value);
}

/**
 * Parse process stdout strictly: one JSON record, optionally followed by one
 * LF (or CRLF). Diagnostics and additional records are rejected.
 */
export function parseReviewResultOutput(output: string): ReviewResult | undefined {
  if (!output) return undefined;
  let payload = output;
  if (payload.endsWith("\n")) {
    payload = payload.slice(0, -1);
    if (payload.endsWith("\r")) payload = payload.slice(0, -1);
  }
  return parseReviewResultLine(payload);
}
