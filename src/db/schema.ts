import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  jsonb,
  date,
  integer,
  real,
  boolean,
  bigint,
  unique,
  uniqueIndex,
  index,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---- enums ----
export const meetingSourceEnum = pgEnum("meeting_source", [
  "calendar",
  "manual",
]);
export const actionItemOwnerEnum = pgEnum("action_item_owner", [
  "me",
  "other",
  "unsure",
]);
export const actionItemStatusEnum = pgEnum("action_item_status", [
  "open",
  "done",
]);
export const actionItemSourceEnum = pgEnum("action_item_source", [
  "meeting",
  "manual",
]);
export const projectStatusEnum = pgEnum("project_status", [
  "active",
  "archived",
]);
export const recurrenceUnitEnum = pgEnum("recurrence_unit", [
  "day",
  "weekday",
  "week",
  "month",
  "year",
]);
export const apiTokenScopeEnum = pgEnum("api_token_scope", ["read", "write"]);
// Journal stat kinds. scale = labeled 1..N buttons; number = free numeric (opt
// min/max/unit); boolean = yes/no; text = free-text reflection (Wins/Learnings).
export const journalStatTypeEnum = pgEnum("journal_stat_type", [
  "scale",
  "number",
  "boolean",
  "text",
]);
// Which way is "up" for trend arrows + chart tone. good = higher is better
// (productivity), bad = higher is worse (anxiety), neutral = no judgement.
export const journalStatDirectionEnum = pgEnum("journal_stat_direction", [
  "good",
  "bad",
  "neutral",
]);

// Toggleable app areas, per workspace. "calendar" is the ICS import within
// Meetings; the rest map 1:1 to nav sections. Tasks and the dashboard are
// always on.
export const WORKSPACE_FEATURES = [
  "calendar",
  "meetings",
  "projects",
  "people",
  "notes",
  "journal",
  "reports",
  "files",
] as const;
export type WorkspaceFeature = (typeof WORKSPACE_FEATURES)[number];

// ---- workspaces ----
// Top-level partition of ALL content (meetings, tasks, projects, people, notes,
// journal, hidden titles) — one per life area (e.g. Work, Consulting, Community,
// Home). The active one is a cookie; switching swaps everything the app shows.
// Exactly one row is the default (partial unique index below) — the fallback
// when no cookie is set.
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // Optional published ICS feed for this workspace (null = manual-only).
    // The legacy CALENDAR_ICS_URL env var is adopted into the default
    // workspace's row by the migration runner, then unused.
    icsUrl: text("ics_url"),
    // Optional Google Calendar source: which connected account + which of that
    // account's calendars this workspace imports from. Both set → Google is the
    // source (takes precedence over ics_url); null → fall back to ics_url/manual.
    googleAccountId: uuid("google_account_id").references(
      (): AnyPgColumn => googleAccounts.id,
      { onDelete: "set null" },
    ),
    googleCalendarId: text("google_calendar_id"),
    // Google Drive folder ids for this workspace's subtree under the app's
    // root MeetingHub folder (see lib/drive.ts). All lazily created on first
    // use and self-healing: if a stored id turns out trashed/deleted, it's
    // nulled and the folder is recreated. Never user-editable.
    driveFolderId: text("drive_folder_id"),
    driveFilesFolderId: text("drive_files_folder_id"),
    driveProjectsFolderId: text("drive_projects_folder_id"),
    driveArchivedFolderId: text("drive_archived_folder_id"),
    // Feature toggles, stored as the DISABLED set so new features default on
    // everywhere (an empty list = full app). Keys: WorkspaceFeature below.
    disabledFeatures: jsonb("disabled_features")
      .$type<WorkspaceFeature[]>()
      .notNull()
      .default([]),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("workspaces_one_default")
      .on(t.isDefault)
      .where(sql`is_default`),
  ],
);

// The seeded default workspace's fixed id (inserted by migration 0022; all
// pre-workspace rows were adopted into it by 0023's transitional defaults).
export const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

// ---- users ----
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // Password login is disabled once a passkey is registered (re-enabled in Settings
  // or via the auth:reset break-glass script).
  passwordEnabled: boolean("password_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Connected Google accounts for calendar import. The single user can connect
// several (work, personal, …); each holds one long-lived OAuth refresh token
// (encrypted at rest — see lib/crypto). Workspaces point at a specific calendar
// within one of these accounts. Access tokens are never stored (refreshed per
// import). Reconnecting the same Google account updates the row (email unique).
export const googleAccounts = pgTable("google_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  // AES-256-GCM ciphertext (iv:tag:data, base64) — never store the plaintext token.
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  scope: text("scope"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// WebAuthn (passkey) credentials — YubiKey, Touch ID, etc. One user, many passkeys.
export const webauthnCredentials = pgTable("webauthn_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  credentialId: text("credential_id").notNull().unique(), // base64url
  publicKey: text("public_key").notNull(), // base64url COSE key
  counter: bigint("counter", { mode: "number" }).notNull().default(0),
  transports: jsonb("transports").$type<string[]>().notNull().default([]),
  name: text("name").notNull().default("Passkey"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

// One-time recovery codes — the lockout backup once password login is disabled.
export const recoveryCodes = pgTable("recovery_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Scoped bearer tokens for the public /api/v1 API (Settings → API tokens).
// The secret is shown once at creation; only its SHA-256 is stored. Lookup is
// by token_hash (unique index) — hashing the presented token before the b-tree
// comparison destroys any timing structure, so no constant-time loop is needed.
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // First chars of the full secret, for identifying a token in the list UI.
    tokenPrefix: text("token_prefix").notNull(),
    // Hex SHA-256 of the full secret (including the "mh_" prefix).
    tokenHash: text("token_hash").notNull(),
    // write implies read.
    scope: apiTokenScopeEnum("scope").notNull().default("read"),
    // null = all workspaces; non-empty array = allowed subset. Deliberately not
    // an FK: verify-time intersection with live workspaces makes stale ids inert.
    workspaceIds: jsonb("workspace_ids").$type<string[] | null>().default(null),
    expiresAt: timestamp("expires_at", { withTimezone: true }), // null = never
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("api_tokens_token_hash_idx").on(t.tokenHash)],
);

// ---- OAuth (MCP connector) ----
// Minimal OAuth 2.1 authorization server backing the /api/mcp connector
// endpoint (claude.ai custom connectors only speak OAuth, not raw bearer
// tokens). Dynamically registered public clients (PKCE, no secret) and
// short-lived single-use authorization codes. Approved grants become ordinary
// api_tokens rows, so revocation lives in Settings -> API tokens.
export const oauthClients = pgTable("oauth_clients", {
  // The id doubles as the public client_id.
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const oauthCodes = pgTable(
  "oauth_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Hex SHA-256 of the code; the plaintext only travels in the redirect.
    codeHash: text("code_hash").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    // PKCE S256 challenge from the authorize request.
    codeChallenge: text("code_challenge").notNull(),
    // Consent choices, copied onto the minted api_token at redemption.
    scope: apiTokenScopeEnum("scope").notNull(),
    workspaceIds: jsonb("workspace_ids").$type<string[] | null>().default(null),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("oauth_codes_code_hash_idx").on(t.codeHash)],
);

// ---- projects ----
// A larger initiative that meetings/action items can be grouped under.
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // restrict (not cascade): workspace deletion is app-guarded to empty
    // workspaces — a DB cascade wiping content is the wrong failure mode.
    // Same on every scoped table below.
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    deadline: date("deadline"), // YYYY-MM-DD
    status: projectStatusEnum("status").notNull().default("active"),
    // Set when status -> archived (cleared if reactivated); mirrors action_items.completedAt.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // This project's Google Drive folder (under <workspace>/Projects/), lazily
    // created on first Files-tab use; moved to Projects/_archived on delete.
    driveFolderId: text("drive_folder_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("projects_workspace_id_idx").on(t.workspaceId)],
);

// A saved hyperlink on a project (Confluence page, spreadsheet, PDF, etc.). The
// content type is inferred from the URL at render time, not stored — it's fully
// derivable, so storing it would just be a second thing to keep in sync.
export const projectLinks = pgTable("project_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  // Optional display name; falls back to the URL itself when empty.
  label: text("label"),
  // Optional placement inside the project's Drive folder tree (unified
  // Files & Links browser). Null = the project's top level; also the
  // self-heal fallback when the referenced folder disappears from Drive.
  driveFolderId: text("drive_folder_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// A named checkpoint within a project ("Design freeze — Aug 15"). Tasks can be
// assigned to one (action_items.milestone_id); progress is computed from those
// at read time. Completion is MANUAL (completed_at), never auto-derived from
// task counts. No workspace_id — scope inherits via the parent project, same
// as project_links. The task↔milestone same-project rule is enforced in
// lib/action-items.ts, not the DB.
export const projectMilestones = pgTable(
  "project_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dueDate: date("due_date"), // YYYY-MM-DD; null = "someday", hub-only
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("project_milestones_project_id_idx").on(t.projectId)],
);

// ---- people ----
// Directs/peers/forums the user meets with. A meeting belongs to a person when
// its attendees contain the person's email OR its exact title is linked below.
// Matching is computed at read time, never stored — the ICS sync clobbers
// attendees on every import, so persisted links would rot.
export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    // Matched (lowercased on write) against meetings.attendees[].email. Nullable:
    // some entries (e.g. a recurring forum) are title-linked only. Never create a
    // person with the user's own email — it would match every meeting.
    // Unique per workspace: the same colleague may exist in two workspaces.
    email: text("email"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.workspaceId, t.email),
    index("people_workspace_id_idx").on(t.workspaceId),
  ],
);

// Exact-title link rules (mirrors hidden_meeting_titles semantics). Not unique
// on title alone — a team-sync title may legitimately match several people.
export const personMeetingTitles = pgTable(
  "person_meeting_titles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.personId, t.title)],
);

// ---- agenda_items ----
// "Raise this with X next time." Open = discussed_at IS NULL. Checking one off
// during a meeting records where it was discussed; history survives meeting
// deletion (set null).
export const agendaItems = pgTable("agenda_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id")
    .notNull()
    .references(() => people.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  discussedAt: timestamp("discussed_at", { withTimezone: true }),
  discussedMeetingId: uuid("discussed_meeting_id").references(
    () => meetings.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---- notes ----
// A standalone first-class note: explicit title + markdown body. The body uses the
// same autosave/conflict contract as meetings/journal (notes + notes_updated_at),
// so the shared NotesEditor works unchanged.
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    title: text("title").notNull().default(""), // "" renders as "Untitled"
    notes: text("notes").notNull().default(""),
    notesUpdatedAt: timestamp("notes_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("notes_workspace_id_idx").on(t.workspaceId)],
);

// Many-to-many attachments tying a note to projects/meetings. Both FKs cascade:
// deleting either side removes the attachment row only — the note itself survives
// as unattached (mirrors the "detach, don't delete" semantics projects use).
export const noteProjects = pgTable(
  "note_projects",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.projectId] })],
);

export const noteMeetings = pgTable(
  "note_meetings",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.meetingId] })],
);

// ---- meetings ----
// An attendee is a free-form object; we only rely on these optional fields.
export type Attendee = {
  email?: string;
  name?: string;
  responseStatus?: string;
};

export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    // Join key for calendar import + ingest matching. Unique per workspace:
    // the same feed subscribed in two workspaces yields the same iCal UIDs.
    calendarEventId: text("calendar_event_id"),
    title: text("title").notNull(),
    // Calendar event description/body (markdown or plain text). Read-only metadata.
    description: text("description"),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }),
    attendees: jsonb("attendees").$type<Attendee[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    // Used for offline-draft conflict checks (feature 4).
    notesUpdatedAt: timestamp("notes_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Generated meeting notes pushed via /api/ingest by an external note source. Editable.
    notesGenerated: text("notes_generated"),
    notesGeneratedUpdatedAt: timestamp("notes_generated_updated_at", {
      withTimezone: true,
    }),
    // The source app's stable id once an ingest is matched/created here, so future
    // pushes for it auto-match (independent of the iCal calendar_event_id).
    externalRef: text("external_ref"),
    source: meetingSourceEnum("source").notNull().default("manual"),
    // "Skip today" hides this specific occurrence from the list.
    skipped: boolean("skipped").notNull().default(false),
    // Optional grouping under a larger initiative. Detached (not deleted) if the project goes away.
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    // "Doesn't need a project" — dismissed from the Projects triage inbox.
    untaggedDismissedAt: timestamp("untagged_dismissed_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique().on(t.workspaceId, t.calendarEventId),
    index("meetings_workspace_id_idx").on(t.workspaceId),
  ],
);

// Generated-notes pushes (via /api/ingest) that did not match a meeting yet.
// An inbox to review: match to an existing meeting or create a new one.
export const pendingIngests = pgTable("pending_ingests", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The source app's stable id for the meeting (iCal UID, or its own id for custom).
  sourceId: text("source_id").notNull().unique(),
  // Where this push should land once resolved. Set when the push carried a
  // `workspace` hint that matched a workspace by name; null = untagged (the
  // reviewer routes it). set null (not cascade): the inbox item outlives a
  // deleted workspace as untagged rather than vanishing.
  workspaceId: uuid("workspace_id").references(() => workspaces.id, {
    onDelete: "set null",
  }),
  // The raw hint as the source app sent it — kept even when unresolved so the
  // inbox can show where the push came from.
  workspaceHint: text("workspace_hint"),
  title: text("title").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }),
  notesGenerated: text("notes_generated").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---- app_settings ----
// Tiny key/value store for app-level preferences (the Advanced settings
// toggles). Booleans are stored as "1"/"0".
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// "Hide" rules: exact-title matches are hidden from the list on/after the rule's day.
export const hiddenMeetingTitles = pgTable(
  "hidden_meeting_titles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.workspaceId, t.title)],
);

// ---- journal ----
// One entry per calendar day per workspace. notes autosaves like meeting notes;
// the Meta fields (all optional) are for later reporting on how the day felt.
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    entryDate: date("entry_date").notNull(), // YYYY-MM-DD in app tz
    notes: text("notes").notNull().default(""),
    notesUpdatedAt: timestamp("notes_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Day-tracking metrics moved to user-definable journal_stats +
    // journal_stat_values (migrated in 0030, old columns dropped in 0031).
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.workspaceId, t.entryDate)],
);

// ---- journal stats ----
// User-definable per-workspace metrics logged on each journal entry. Replaces the
// former fixed productivity/anxiety/wins/learnings columns; those become seeded rows.
export type JournalStatConfig = {
  // scale: ordered option labels; length = scale size (e.g. 5), index+1 = value.
  labels?: string[];
  // number: optional bounds + unit for the input and chart axis.
  min?: number;
  max?: number;
  unit?: string;
  // text: optional textarea placeholder.
  placeholder?: string;
};

export const journalStats = pgTable(
  "journal_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    type: journalStatTypeEnum("type").notNull(),
    direction: journalStatDirectionEnum("direction")
      .notNull()
      .default("neutral"),
    config: jsonb("config").$type<JournalStatConfig>().notNull().default({}),
    showOnDashboard: boolean("show_on_dashboard").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    // null = active; set = archived (hidden from the panel/dashboard, but its
    // historical values are kept for reports).
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("journal_stats_workspace_id_idx").on(t.workspaceId),
    // At most one active stat per (workspace, name), case-insensitive.
    uniqueIndex("journal_stats_workspace_name_active")
      .on(t.workspaceId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
  ],
);

// One value per (entry, stat). num_value carries scale (1..N) / number /
// boolean (0|1); text_value carries the text type. Both null = nothing logged.
export const journalStatValues = pgTable(
  "journal_stat_values",
  {
    journalEntryId: uuid("journal_entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    statId: uuid("stat_id")
      .notNull()
      .references(() => journalStats.id, { onDelete: "cascade" }),
    numValue: real("num_value"),
    textValue: text("text_value"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.journalEntryId, t.statId] }),
    index("journal_stat_values_stat_id_idx").on(t.statId),
  ],
);

// ---- action_items ----
// Built to absorb a dedicated task manager later: priority/category exist now but are unused in the MVP UI.
export const actionItems = pgTable(
  "action_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    // null meeting_id = standalone/manual task.
    meetingId: uuid("meeting_id").references(() => meetings.id, {
      onDelete: "cascade",
    }),
    // Set when the item was created from a journal entry (groups under "This entry").
    journalEntryId: uuid("journal_entry_id").references(
      () => journalEntries.id,
      { onDelete: "set null" },
    ),
    // Optional grouping under a larger initiative. Detached (not deleted) if the project goes away.
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    // Optional checkpoint within that project; must belong to the same project
    // (lib-enforced). Detached when the milestone is deleted.
    milestoneId: uuid("milestone_id").references(() => projectMilestones.id, {
      onDelete: "set null",
    }),
    // "Doesn't need a project" — dismissed from the Projects triage inbox.
    untaggedDismissedAt: timestamp("untagged_dismissed_at", {
      withTimezone: true,
    }),
    content: text("content").notNull(),
    // owner="other" means "waiting on someone else"; owner_name is the free-text
    // who, waiting_on_person_id the linked variant. The lib keeps them coherent.
    owner: actionItemOwnerEnum("owner").notNull().default("unsure"),
    // Optional free-text when owner = other.
    ownerName: text("owner_name"),
    // Linked "waiting on" person; detached (not deleted) if the person goes away.
    waitingOnPersonId: uuid("waiting_on_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    status: actionItemStatusEnum("status").notNull().default("open"),
    dueDate: date("due_date"),
    // Set when status -> done (cleared if reopened); powers the reports "completed/day".
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Reserved for a future task-manager merge — unused in MVP UI.
    priority: integer("priority"),
    category: text("category"),
    // Recurrence rule: "every `interval` `unit`s" ("weekday" ignores interval).
    // null unit = one-off. Completing a recurring item spawns the next occurrence
    // and moves the rule onto it, so the done row is a plain historical record.
    recurrenceUnit: recurrenceUnitEnum("recurrence_unit"),
    recurrenceInterval: integer("recurrence_interval"),
    // Snooze: hidden from all open lists/counts until this date arrives (same
    // treatment as a recurring occurrence that isn't due yet). Cleared on
    // complete/reopen.
    snoozedUntil: date("snoozed_until"),
    source: actionItemSourceEnum("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("action_items_workspace_id_idx").on(t.workspaceId),
    // Serves the grouped per-milestone progress counts.
    index("action_items_milestone_id_idx").on(t.milestoneId),
  ],
);

// ---- task_dependencies ----
// Directed edge: taskId depends on dependsOnId (dependsOnId must finish first).
// No detached state for a half-edge, so both FKs cascade — the edge disappears
// with either task rather than lingering or nulling out.
export const taskDependencies = pgTable(
  "task_dependencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => actionItems.id, { onDelete: "cascade" }),
    dependsOnId: uuid("depends_on_id")
      .notNull()
      .references(() => actionItems.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.taskId, t.dependsOnId)],
);

// ---- inferred types ----
export type OauthClient = typeof oauthClients.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type TaskDependency = typeof taskDependencies.$inferSelect;
export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectLink = typeof projectLinks.$inferSelect;
export type ProjectMilestone = typeof projectMilestones.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type Person = typeof people.$inferSelect;
export type PersonMeetingTitle = typeof personMeetingTitles.$inferSelect;
export type AgendaItem = typeof agendaItems.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type NewMeeting = typeof meetings.$inferInsert;
export type ActionItem = typeof actionItems.$inferSelect;
export type NewActionItem = typeof actionItems.$inferInsert;
export type PendingIngest = typeof pendingIngests.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type GoogleAccount = typeof googleAccounts.$inferSelect;
export type JournalStat = typeof journalStats.$inferSelect;
export type JournalStatValue = typeof journalStatValues.$inferSelect;
export type WebauthnCredential = typeof webauthnCredentials.$inferSelect;
export type RecoveryCode = typeof recoveryCodes.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
