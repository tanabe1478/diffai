import type { Proposal } from "./types";
import type { FileTreeNode } from "./reviewTypes";

export function buildFileTree(proposals: Proposal[]): FileTreeNode[] {
  const root: FileTreeNode = { name: "", path: "", children: [] };

  for (const proposal of proposals) {
    let node = root;
    const parts = proposal.path.split("/");

    for (let index = 0; index < parts.length; index++) {
      const name = parts[index];
      const nodePath = parts.slice(0, index + 1).join("/");
      let child = node.children.find(item => item.name === name);

      if (!child) {
        child = { name, path: nodePath, children: [] };
        node.children.push(child);
      }

      if (index === parts.length - 1) child.proposal = proposal;
      node = child;
    }
  }

  return sortTree(root.children);
}

function sortTree(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes
    .sort((a, b) => Number(!!a.proposal) - Number(!!b.proposal) || a.name.localeCompare(b.name))
    .map(node => ({ ...node, children: sortTree(node.children) }));
}
