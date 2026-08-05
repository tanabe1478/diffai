import type { Proposal } from "./types";

export type Side = "old" | "new";

export type LineComment = {
  id: string;
  proposalId: string;
  side: Side;
  line: number;
  body: string;
  quote?: string;
};

export type FileTreeNode = {
  name: string;
  path: string;
  children: FileTreeNode[];
  proposal?: Proposal;
};
