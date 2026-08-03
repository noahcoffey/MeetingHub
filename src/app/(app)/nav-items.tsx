// Shared nav definitions for the desktop sidebar (side-nav.tsx) and the
// mobile bottom tab bar (mobile-tab-bar.tsx). `feature` ties an item to a
// workspace toggle; items without one (Dashboard, Tasks) are always shown.

export type NavItem = {
  href: string;
  label: string;
  match: (p: string) => boolean;
  feature?: string;
  icon: React.ReactNode;
};

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    match: (p: string) => p === "/",
    icon: (
      <>
        <rect x="3.5" y="3.5" width="6" height="6" rx="1" strokeWidth="1.5" />
        <rect x="10.5" y="3.5" width="6" height="4.5" rx="1" strokeWidth="1.5" />
        <rect x="10.5" y="10" width="6" height="6.5" rx="1" strokeWidth="1.5" />
        <rect x="3.5" y="11.5" width="6" height="5" rx="1" strokeWidth="1.5" />
      </>
    ),
  },
  {
    href: "/meetings",
    label: "Meetings",
    feature: "meetings",
    match: (p: string) => p.startsWith("/meetings"),
    icon: (
      <path d="M4 5.5h12M4 10h12M4 14.5h7" strokeWidth="1.6" strokeLinecap="round" />
    ),
  },
  {
    href: "/tasks",
    label: "Tasks",
    match: (p: string) => p.startsWith("/tasks"),
    icon: (
      <>
        <path d="M4 6l2 2 3-3.5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 13l2 2 3-3.5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 6h4M12 13.5h4" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: "/projects",
    label: "Projects",
    feature: "projects",
    match: (p: string) => p.startsWith("/projects"),
    icon: (
      <path
        d="M3.5 6a1 1 0 011-1h4l1.5 1.5H15a1 1 0 011 1V14a1 1 0 01-1 1H4.5a1 1 0 01-1-1V6z"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    ),
  },
  {
    href: "/people",
    label: "People",
    feature: "people",
    match: (p: string) => p.startsWith("/people"),
    icon: (
      <>
        <circle cx="10" cy="6.5" r="3" strokeWidth="1.5" />
        <path
          d="M4 16.5a6 6 0 0 1 12 0"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </>
    ),
  },
  {
    href: "/notes",
    label: "Notes",
    feature: "notes",
    match: (p: string) => p.startsWith("/notes"),
    icon: (
      <>
        <path
          d="M4.5 4.5a1 1 0 011-1h9a1 1 0 011 1v7l-4.5 4.5h-5.5a1 1 0 01-1-1v-10.5z"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M11 16v-3.5a1 1 0 011-1h3.5" strokeWidth="1.5" strokeLinejoin="round" />
      </>
    ),
  },
  {
    href: "/files",
    label: "Files",
    feature: "files",
    match: (p: string) => p.startsWith("/files"),
    icon: (
      <>
        <path
          d="M5.5 3.5h6L15 7v9a.9.9 0 01-.9.9H5.5a.9.9 0 01-.9-.9v-11a.9.9 0 01.9-.9z"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M11.5 3.5V7H15" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M7.5 11h5M7.5 13.5h3" strokeWidth="1.4" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: "/journal",
    label: "Journal",
    feature: "journal",
    match: (p: string) => p.startsWith("/journal"),
    icon: (
      <>
        <path
          d="M5 3.5h9a1 1 0 011 1v11a1 1 0 01-1 1H5z"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M5 3.5a1.5 1.5 0 000 3h1.5V3.5z" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M8.5 7.5h3.5M8.5 10.5h3.5" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: "/reports",
    label: "Reports",
    feature: "reports",
    match: (p: string) => p.startsWith("/reports"),
    icon: (
      <>
        <path d="M4 16.5V9M10 16.5V4.5M16 16.5v-5" strokeWidth="1.7" strokeLinecap="round" />
      </>
    ),
  },
  {
    // No feature key: like Tasks, always visible. Which workspaces actually
    // get summaries is decided by the local runner's config; a workspace the
    // runner skips just shows the empty state.
    href: "/summaries",
    label: "Summaries",
    match: (p: string) => p.startsWith("/summaries"),
    icon: (
      <>
        <path
          d="M4 4.5a1 1 0 011-1h10a1 1 0 011 1v11a1 1 0 01-1 1H5a1 1 0 01-1-1v-11z"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M7 7.5h6M7 10h6M7 12.5h3.5" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="13.75" cy="13.75" r="0.4" strokeWidth="1.2" />
      </>
    ),
  },
];
