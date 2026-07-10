export type ProposalStatus = "pending" | "approved" | "rejected";
export interface Proposal { id: string; path: string; before: string; after: string; summary: string; status: ProposalStatus; feedback?: string }
export type ServerEvent =
  | { type: "ready"; cwd: string; model?: string; proposals: Proposal[] }
  | { type: "proposal"; proposal: Proposal }
  | { type: "proposal_updated"; proposal: Proposal }
  | { type: "text_delta"; delta: string }
  | { type: "status"; status: string; detail?: string }
  | { type: "error"; message: string };
