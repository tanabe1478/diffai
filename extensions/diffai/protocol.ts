// Keep this import path as a small compatibility shim for the extension's
// internal modules; the actual wire contract lives in the Pi-independent
// package protocol module.
export {
  REVIEW_RESULT_SCHEMA_VERSION,
  buildReviewResult,
  isReviewResult,
  parseReviewResultLine,
  parseReviewResultOutput,
  serializeReviewResult,
  validateReviewResult,
} from "../../protocol/index.js";
export type {
  FileFeedback,
  ReplyFormat,
  ReplyStatus,
  ReviewComment,
  ReviewCommentSide,
  ReviewDecision,
  ReviewFeedback,
  ReviewItem,
  ReviewItemStatus,
  ReviewResult,
  ReviewResultInput,
} from "../../protocol/index.js";
