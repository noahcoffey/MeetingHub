import type { LinkType } from "@/lib/link-type";

// Simple, distinct-by-color-and-shape glyphs per content type — not exact
// brand marks, just enough visual difference to scan a list of links at a
// glance. Solid fills (not currentColor) since the color IS the signal here.
function DocIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M5 2.5h6.5L15.5 6.5v11a1 1 0 01-1 1H5a1 1 0 01-1-1v-14a1 1 0 011-1z"
        fill={color}
        fillOpacity="0.18"
        stroke={color}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M11.5 2.5v4h4" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function GridIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="3" y="3" width="14" height="14" rx="1.5" stroke={color} strokeWidth="1.3" />
      <path d="M3 8.3h14M3 13.7h14M8.3 3v14" stroke={color} strokeWidth="1.1" />
    </svg>
  );
}

function BubbleIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M3 5.5A2.5 2.5 0 015.5 3h9A2.5 2.5 0 0117 5.5v6a2.5 2.5 0 01-2.5 2.5H9l-4 3v-3H5.5A2.5 2.5 0 013 11.5v-6z"
        fill={color}
        fillOpacity="0.18"
        stroke={color}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TicketIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M10 2 3 9l7 9 7-9z"
        fill={color}
        fillOpacity="0.2"
        stroke={color}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function VideoIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="2.5" y="5" width="10.5" height="10" rx="2" stroke={color} strokeWidth="1.3" />
      <path d="M13 8.3l4.5-2.6v8.6L13 11.7z" fill={color} fillOpacity="0.3" stroke={color} strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

function CodeIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="7.5" stroke={color} strokeWidth="1.3" />
      <path
        d="M7.5 7.5 5 10l2.5 2.5M12.5 7.5 15 10l-2.5 2.5"
        stroke={color}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShapesIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="8" cy="7.5" r="3.5" fill={color} fillOpacity="0.35" stroke={color} strokeWidth="1.1" />
      <rect x="9.5" y="9.5" width="7" height="7" rx="1.5" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1.1" />
    </svg>
  );
}

function SquareMarkIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="3" y="3" width="14" height="14" rx="3" stroke={color} strokeWidth="1.3" />
      <path d="M7 6.5v7l6-7v7" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChainIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M8.5 11.5a3 3 0 004.24 0l2-2a3 3 0 00-4.24-4.24l-1 1"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M11.5 8.5a3 3 0 00-4.24 0l-2 2a3 3 0 004.24 4.24l1-1"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

const COLORS: Partial<Record<LinkType, string>> = {
  pdf: "#e5484d",
  word: "#2b579a",
  powerpoint: "#d24726",
  excel: "#217346",
  confluence: "#1868db",
  jira: "#2684ff",
  teams: "#6264a7",
  slack: "#e01e5a",
  github: "#6e7781",
  figma: "#a259ff",
  notion: "#37352f",
  zoom: "#2d8cff",
  googledoc: "#4285f4",
  googlesheet: "#34a853",
  googleslide: "#fbbc05",
};

export function LinkTypeIcon({ type }: { type: LinkType }) {
  const color = COLORS[type];
  switch (type) {
    case "pdf":
    case "word":
    case "googledoc":
      return <DocIcon color={color as string} />;
    case "powerpoint":
    case "googleslide":
      return <VideoIcon color={color as string} />;
    case "excel":
    case "googlesheet":
      return <GridIcon color={color as string} />;
    case "confluence":
      return <DocIcon color={color as string} />;
    case "jira":
      return <TicketIcon color={color as string} />;
    case "teams":
    case "slack":
      return <BubbleIcon color={color as string} />;
    case "github":
      return <CodeIcon color={color as string} />;
    case "figma":
      return <ShapesIcon color={color as string} />;
    case "notion":
      return <SquareMarkIcon color={color as string} />;
    case "zoom":
      return <VideoIcon color={color as string} />;
    default:
      return <ChainIcon />;
  }
}
