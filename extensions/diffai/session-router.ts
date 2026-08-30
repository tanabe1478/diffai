import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export const DIFFAI_REVIEW_STATE = "diffai:review-state";
export type ReviewPhase = "reviewing" | "waiting_for_agent" | "ended";
export type ReviewState = { version: 1; reviewId: string; phase: ReviewPhase };
export type SessionIdentity = { sessionId: string; leafId: string | null };

export function readReviewState(entries: SessionEntry[]): ReviewState | undefined {
  for (const entry of [...entries].reverse()) {
    if (entry.type !== "custom" || entry.customType !== DIFFAI_REVIEW_STATE) continue;
    const data = entry.data;
    if (!data || typeof data !== "object") continue;
    const candidate = data as Record<string, unknown>;
    if (candidate.version !== 1 || typeof candidate.reviewId !== "string" || !candidate.reviewId) continue;
    if (candidate.phase !== "reviewing" && candidate.phase !== "waiting_for_agent" && candidate.phase !== "ended") continue;
    return candidate as unknown as ReviewState;
  }
  return undefined;
}

/** Session entries are read from the current branch, never from sibling branches. */
export function restoreReviewState(ctx: ExtensionContext): ReviewState | undefined {
  return readReviewState(ctx.sessionManager.getBranch());
}

/** Identity of the exact session/tree position an asynchronous review belongs to. */
export function getSessionIdentity(ctx: ExtensionContext): SessionIdentity {
  // The fallbacks keep the small dependency-injected unit-test contexts useful;
  // real Pi contexts always provide both methods.
  const manager = ctx.sessionManager as typeof ctx.sessionManager & {
    getSessionId?: () => string;
    getLeafId?: () => string | null;
  };
  return {
    sessionId: typeof manager.getSessionId === "function" ? manager.getSessionId() : "",
    leafId: typeof manager.getLeafId === "function" ? manager.getLeafId() : null,
  };
}

export class SessionRouter {
  constructor(private readonly pi: Pick<ExtensionAPI, "appendEntry">) {}

  persist(state: ReviewState): void {
    this.pi.appendEntry(DIFFAI_REVIEW_STATE, state);
  }

  restore(ctx: ExtensionContext): ReviewState | undefined {
    return restoreReviewState(ctx);
  }
}
