export type ProposalStatus = "pending" | "approved" | "rejected";
export interface Proposal { id: string; path: string; before: string; after: string; summary: string; status: ProposalStatus; feedback?: string; reviewOnly?: boolean }
export interface GitCommit { hash: string; shortHash: string; subject: string; author: string; date: string }
export interface GitRef { name: string; hash: string }
export interface ReviewReply { commentId: string; status: "fixed" | "replied" | "wontfix"; body: string }
export type ServerEvent =
  | { type: "ready"; cwd: string; model?: string; proposals: Proposal[]; commits: GitCommit[]; refs: GitRef[]; waitMode: boolean; initialTarget: string; reviewSessionId: string; replies: ReviewReply[] }
  | { type: "review_loaded"; cwd: string; label: string; proposals: Proposal[]; reviewSessionId: string; replies: ReviewReply[] }
  | { type: "proposal"; proposal: Proposal }
  | { type: "proposal_updated"; proposal: Proposal }
  | { type: "text_delta"; delta: string }
  | { type: "status"; status: string; detail?: string }
  | { type: "error"; message: string };
