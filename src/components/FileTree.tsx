import type React from "react";
import type { Proposal } from "../types";
import type { FileTreeNode } from "../reviewTypes";

type Props = {
  nodes: FileTreeNode[];
  selected?: string;
  viewed: Record<string, boolean>;
  statusOf: (proposal: Proposal) => Proposal["status"];
  onSelect: (id: string) => void;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  depth?: number;
};

export function FileTree({ nodes, selected, viewed, statusOf, onSelect, collapsed, onToggle, depth = 0 }: Props) {
  return <div className={depth === 0 ? "file-tree" : "tree-children"}>{nodes.map(node => {
    if (node.proposal) {
      return <button
        className={`tree-file ${selected === node.proposal.id ? "active" : ""}`}
        style={{ "--depth": depth } as React.CSSProperties}
        onClick={() => onSelect(node.proposal!.id)}
        key={node.path}
      >
        <i className={statusOf(node.proposal)} aria-label={`判断: ${statusOf(node.proposal)}`}/>
        <span>{node.name}<small>{node.proposal.path}</small></span>
        <b className={`viewed-mark ${viewed[node.proposal.id] ? "is-viewed" : ""}`} aria-label={viewed[node.proposal.id] ? "閲覧済み" : "未閲覧"}>{viewed[node.proposal.id] ? "✓" : ""}</b>
      </button>;
    }

    const isCollapsed = collapsed.has(node.path);
    return <div key={node.path}>
      <button
        className="tree-dir"
        style={{ "--depth": depth } as React.CSSProperties}
        onClick={() => onToggle(node.path)}
        aria-expanded={!isCollapsed}
      >
        <span>{isCollapsed ? "▸" : "▾"}</span>{node.name}
      </button>
      {!isCollapsed && <FileTree nodes={node.children} selected={selected} viewed={viewed} statusOf={statusOf} onSelect={onSelect} collapsed={collapsed} onToggle={onToggle} depth={depth + 1}/>}
    </div>;
  })}</div>;
}
