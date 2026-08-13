import type { ProjectRelationKind } from "@/db/schema";

// Shared between the meeting-rail capture section and the project map so the
// two never drift on wording.
export const RELATION_KINDS: ProjectRelationKind[] = [
  "related",
  "blocks",
  "depends_on",
  "spun_from",
];

// Label from the perspective of the project you're looking at ("out" = this
// project is the edge's fromId).
export function relationLabel(
  kind: ProjectRelationKind,
  direction: "out" | "in",
): string {
  switch (kind) {
    case "blocks":
      return direction === "out" ? "blocks" : "blocked by";
    case "depends_on":
      return direction === "out" ? "depends on" : "needed by";
    case "spun_from":
      return direction === "out" ? "spun off from" : "spun off";
    default:
      return "related";
  }
}

// Neutral label for the picker, where there's no established perspective yet.
export const KIND_OPTION_LABEL: Record<ProjectRelationKind, string> = {
  related: "related to",
  blocks: "blocks",
  depends_on: "depends on",
  spun_from: "spun off from",
};
