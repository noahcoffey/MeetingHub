# Meeting Hub Ingest API

This document describes the single endpoint an external client uses to push
AI-generated meeting notes into Meeting Hub — for example, a meeting-recorder or
transcription tool that produces a summary and wants it to land next to the
matching calendar meeting.

It is separate from the general-purpose [`/api/v1` token API](API.md); this is a
static-bearer push endpoint purpose-built for one job (deliver generated notes),
while `/api/v1` is scoped-token CRUD over tasks/meetings/projects/notes.

This endpoint is also described in the machine-readable OpenAPI spec at
[`openapi.yaml`](public/openapi.yaml) (under the `Ingest` tag).

## Base URL

```
https://<your-host>
```

(Local dev: `http://localhost:3100`.)

## Authentication

Static bearer token. Send it on every request:

```
Authorization: Bearer <INGEST_API_KEY>
```

The key is configured in Meeting Hub's environment (`INGEST_API_KEY`) by whoever
runs the server; never hard-code it. Requests without a valid key get `401`.

## The endpoint

### `POST /api/ingest`

Pushes generated notes for one meeting. `Content-Type: application/json`.

**Body**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `sourceId` | string | **yes** | Stable id for the meeting. For meetings that came from a subscribed iCal feed, this **must be the iCal `UID`** of that event. For a meeting that exists only in the client, use the client's own stable meeting id. |
| `notesGenerated` | string | **yes** | The generated notes (Markdown recommended — headings, lists, checkboxes, etc. all render). |
| `title` | string | no | Meeting title. Only used if the meeting isn't matched yet (shown in the review inbox / used when creating a new meeting). |
| `startTime` | string (ISO 8601) | no | Meeting start. Same as `title` — only used for the unmatched case. |
| `workspace` | string | no | The client's workspace name (e.g. `"Work"`). Meeting Hub partitions everything by workspace; this routes the push. Matched case-insensitively against Meeting Hub's workspace names — keep the names aligned between the two apps. An unknown name never fails the push; it just lands untagged in the review inbox (with the hint shown). |

**What `sourceId` should be**

Meeting Hub stores each imported iCal event's **`UID`** as its identifier. If your
calendar feed pre-expands recurring meetings into individual `VEVENT`s, each with a
unique `UID`, the `UID` is a reliable 1:1 key. **Track the `UID` per event in the
client and send it as `sourceId`.** That's the join key.

**Matching behavior**

1. Meeting Hub looks for a meeting whose `calendar_event_id` **or** `external_ref`
   equals `sourceId` (across all workspaces; if the same id somehow exists in two,
   a `workspace` hint breaks the tie toward that workspace).
2. **Matched** → it writes `notesGenerated` into that meeting's generated-notes
   field, but **only if that field is currently empty** (it will not overwrite
   notes already present — re-sending is a safe no-op). → HTTP `200`.
3. **No match** (a client-only meeting, or a `UID` Meeting Hub hasn't imported
   yet) → the push is staged in Meeting Hub's "Incoming notes" review inbox, where
   the user matches it to an existing meeting or creates a new one. → HTTP `202`.
   - Re-sending the same `sourceId` updates the same pending entry (no duplicates).
   - A `workspace` hint pre-tags the pending entry: the review screen shows the
     tag, "create meeting" lands it in that workspace automatically, and the
     match picker lists that workspace's meetings.
   - Once the user resolves it, Meeting Hub remembers the `sourceId` on that meeting
     (`external_ref`), so **future pushes for it auto-match** — no repeat review.

**Responses**

- `200 OK` — matched and written:
  ```json
  { "matched": true, "meetingId": "uuid", "written": true }
  ```
- `200 OK` — matched but left unchanged (field already had notes):
  ```json
  { "matched": true, "meetingId": "uuid", "written": false }
  ```
- `202 Accepted` — no match; queued for review:
  ```json
  { "matched": false, "pending": true, "pendingId": "uuid" }
  ```
- `400` — `{ "error": "..." }` (missing/invalid `sourceId` or `notesGenerated`).
- `401` — `{ "error": "unauthorized" }` (bad/missing bearer token).
- `413` — `{ "error": "payload too large" }` (request body over the limit — default
  **5 MB**, ~800k words; raise `INGEST_MAX_BODY_KB` on the server if you ever need more).

### Examples

Calendar-sourced meeting (send the iCal UID):

```bash
curl -X POST https://<your-host>/api/ingest \
  -H "Authorization: Bearer $INGEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceId": "040000008200E00074C5B7101A82E008...",
    "notesGenerated": "## Summary\n\n- Decided X\n- Action: follow up with Y\n\n## Decisions\n..."
  }'
```

Client-only meeting (no iCal UID — send your own id + metadata):

```bash
curl -X POST https://<your-host>/api/ingest \
  -H "Authorization: Bearer $INGEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceId": "ext_meeting_8f2a",
    "title": "Ad-hoc sync",
    "startTime": "2026-06-30T18:00:00Z",
    "notesGenerated": "## Notes\n\n..."
  }'
```

## Notes & guidance

- **Idempotent / safe to retry.** Re-sending the same `sourceId` won't duplicate
  or clobber. If a meeting already has generated notes, the push is a no-op
  (`written: false`) — by design, so manual edits aren't overwritten. Force-replace
  isn't supported via the API today (clear the field in the UI first); open an issue
  if you need a `force` flag.
- **Markdown** is rendered live in Meeting Hub (headings, bold/italic, bullet &
  numbered lists, `- [ ]` checkboxes, blockquotes, code). Plain text is fine too.
- **One meeting per request.** Batch by making multiple calls.
- The generated notes appear in a collapsible "Generated notes" section beneath the
  meeting's own notes, and remain hand-editable in Meeting Hub.
