// Pure URL -> content-type inference for project links. No I/O — runs client
// or server side. Best-effort: falls back to "generic" for anything unrecognized.
export type LinkType =
  | "confluence"
  | "jira"
  | "excel"
  | "word"
  | "powerpoint"
  | "pdf"
  | "teams"
  | "slack"
  | "github"
  | "figma"
  | "notion"
  | "zoom"
  | "googledoc"
  | "googlesheet"
  | "googleslide"
  | "generic";

export function detectLinkType(url: string): LinkType {
  let host = "";
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return "generic";
  }
  const ext = path.includes(".") ? (path.split(".").pop() ?? "") : "";

  if (host.endsWith("atlassian.net")) {
    if (path.includes("/wiki/")) return "confluence";
    if (path.includes("/browse/") || path.includes("/jira/")) return "jira";
  }
  if (host === "docs.google.com") {
    if (path.startsWith("/document")) return "googledoc";
    if (path.startsWith("/spreadsheets")) return "googlesheet";
    if (path.startsWith("/presentation")) return "googleslide";
  }
  if (["xlsx", "xls", "csv"].includes(ext)) return "excel";
  if (["docx", "doc"].includes(ext)) return "word";
  if (["pptx", "ppt"].includes(ext)) return "powerpoint";
  if (ext === "pdf") return "pdf";
  if (host.includes("teams.microsoft.com")) return "teams";
  if (host.endsWith("slack.com")) return "slack";
  if (host.endsWith("github.com")) return "github";
  if (host.endsWith("figma.com")) return "figma";
  if (host.endsWith("notion.so") || host.endsWith("notion.site")) return "notion";
  if (host.endsWith("zoom.us")) return "zoom";
  return "generic";
}

export const LINK_TYPE_LABEL: Record<LinkType, string> = {
  confluence: "Confluence page",
  jira: "Jira issue",
  excel: "Spreadsheet",
  word: "Word document",
  powerpoint: "Slide deck",
  pdf: "PDF",
  teams: "Teams chat",
  slack: "Slack",
  github: "GitHub",
  figma: "Figma",
  notion: "Notion",
  zoom: "Zoom meeting",
  googledoc: "Google Doc",
  googlesheet: "Google Sheet",
  googleslide: "Google Slides",
  generic: "Link",
};
