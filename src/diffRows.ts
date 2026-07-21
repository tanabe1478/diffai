import { diffArrays } from "diff";
import type { DiffRow } from "./reviewTypes";

export function buildRows(before: string, after: string): DiffRow[] {
  const changes = diffArrays(before.split("\n"), after.split("\n"));
  const rows: DiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];

    if (change.removed && changes[i + 1]?.added) {
      const added = changes[++i];
      const count = Math.max(change.value.length, added.value.length);
      for (let j = 0; j < count; j++) {
        rows.push({
          kind: "changed",
          left: change.value[j],
          right: added.value[j],
          leftNo: j < change.value.length ? oldLine++ : undefined,
          rightNo: j < added.value.length ? newLine++ : undefined,
        });
      }
    } else if (change.added) {
      for (const line of change.value) rows.push({ kind: "changed", right: line, rightNo: newLine++ });
    } else if (change.removed) {
      for (const line of change.value) rows.push({ kind: "changed", left: line, leftNo: oldLine++ });
    } else {
      for (const line of change.value) {
        rows.push({ kind: "same", left: line, right: line, leftNo: oldLine++, rightNo: newLine++ });
      }
    }
  }

  return rows;
}
