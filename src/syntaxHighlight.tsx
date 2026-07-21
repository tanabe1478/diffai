import React from "react";
import { common, createStarryNight } from "@wooorm/starry-night";
import sourceTla from "@wooorm/starry-night/source.tla";

type HastNode = {
  type: "root" | "element" | "text";
  value?: string;
  properties?: { className?: string | string[] };
  children?: HastNode[];
};

const highlighter = createStarryNight([...common, sourceTla]);

function languageFlag(path: string) {
  const name = path.split("/").pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : name.toLowerCase();
}

function appendHighlightedText(lines: React.ReactNode[][], value: string, classes: string[], key: { value: number }) {
  const parts = value.split("\n");
  for (let index = 0; index < parts.length; index++) {
    if (index > 0) lines.push([]);
    if (!parts[index]) continue;
    const text = parts[index];
    lines.at(-1)!.push(classes.length
      ? <span className={classes.join(" ")} key={key.value++}>{text}</span>
      : text);
  }
}

function collectLines(node: HastNode, lines: React.ReactNode[][], inherited: string[], key: { value: number }) {
  if (node.type === "text") {
    appendHighlightedText(lines, node.value ?? "", inherited, key);
    return;
  }
  const own = node.properties?.className;
  const classes = own ? [...inherited, ...(Array.isArray(own) ? own : [own])] : inherited;
  for (const child of node.children ?? []) collectLines(child, lines, classes, key);
}

export async function highlightLines(content: string, path: string): Promise<React.ReactNode[][] | undefined> {
  const starryNight = await highlighter;
  const scope = starryNight.flagToScope(languageFlag(path));
  if (!scope) return undefined;
  const tree = starryNight.highlight(content, scope) as HastNode;
  const lines: React.ReactNode[][] = [[]];
  collectLines(tree, lines, [], { value: 0 });
  return lines;
}
