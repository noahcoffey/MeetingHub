// Strips the auto-appended video-conferencing block (Teams/Zoom join info) from a
// calendar description, leaving only what the organizer actually wrote. Pure +
// display-time, so the raw value is preserved in the DB.

const JOIN_MARKERS =
  /(microsoft teams meeting|join the meeting now|join on your computer|teams\.microsoft\.com|join zoom meeting|zoom\.us\/j\/|meeting id:|dial[\s-]?in by phone|find a local number|________)/i;

const MARKER_LINE =
  /(microsoft teams meeting|join the meeting now|join on your computer|join zoom meeting|click here to join the meeting)/i;

export function cleanDescription(raw: string | null | undefined): string {
  if (!raw) return "";
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n");

  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // An underscore separator line whose remainder contains join info.
    if (/^_{5,}$/.test(line) && JOIN_MARKERS.test(lines.slice(i).join("\n"))) {
      cut = i;
      break;
    }
    if (MARKER_LINE.test(line)) {
      cut = i;
      break;
    }
    if (/^<?https:\/\/teams\.microsoft\.com/i.test(line)) {
      cut = i;
      break;
    }
  }

  const kept = (cut >= 0 ? lines.slice(0, cut) : lines).join("\n");
  // Trim leftover separators / blank lines at the edges.
  return kept.replace(/^[\s_]+|[\s_]+$/g, "").trim();
}
