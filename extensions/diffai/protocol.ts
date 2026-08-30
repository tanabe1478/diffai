/** The stable, Pi-independent result returned by the diffai CLI. */
export type ReviewDecision = "approved" | "changes_requested";

export type ReviewResult = {
  decision: ReviewDecision;
  reviewId?: string;
  reviews?: unknown[];
  comments?: unknown[];
  fileFeedback?: unknown[];
  feedback?: unknown;
  replyFile?: string;
  replyFormat?: unknown;
  [key: string]: unknown;
};

export const REVIEW_RESULT_MARKER = "DIFFAI_REVIEW_RESULT=";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse exactly one marker line. The CLI contract deliberately remains a
 * single-line JSON record so callers can consume stdout without Pi.
 */
export function parseReviewResultMarker(line: string): ReviewResult | undefined {
  const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (!normalized.startsWith(REVIEW_RESULT_MARKER)) return undefined;
  const payload = normalized.slice(REVIEW_RESULT_MARKER.length);
  if (!payload || payload.includes("\n") || payload.includes("\r")) {
    throw new Error("DIFFAI_REVIEW_RESULT must contain one-line JSON");
  }
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch (error) {
    throw new Error(`invalid DIFFAI_REVIEW_RESULT JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(value) || (value.decision !== "approved" && value.decision !== "changes_requested")) {
    throw new Error("DIFFAI_REVIEW_RESULT must be an object with decision approved or changes_requested");
  }
  if (value.reviewId !== undefined && typeof value.reviewId !== "string") {
    throw new Error("DIFFAI_REVIEW_RESULT reviewId must be a string");
  }
  return value as ReviewResult;
}

/** Find a strict marker line in accumulated process output. */
export function parseReviewResultOutput(output: string): ReviewResult | undefined {
  for (const line of output.split("\n")) {
    const result = parseReviewResultMarker(line);
    if (result) return result;
  }
  return undefined;
}
