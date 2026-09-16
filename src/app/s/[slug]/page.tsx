import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSharedNote } from "@/lib/notes";
import { formatPrettyDate } from "@/lib/dates";
import { MarkdownView } from "../../(app)/meetings/[id]/markdown-view";

// The one unauthenticated page in the app. It renders exactly one note, fetched
// by its unguessable slug, and links to nothing inside Meeting Hub — no nav, no
// workspace, no attachments, no ids. force-dynamic so revoking a share takes
// effect on the very next request rather than serving a cached copy.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const note = await getSharedNote(slug);
  return {
    title: note?.title?.trim() || "Shared note",
    // A shared link is for the people it was sent to, not for search engines.
    robots: { index: false, follow: false },
  };
}

export default async function SharedNotePage({ params }: Props) {
  const { slug } = await params;
  const note = await getSharedNote(slug);
  if (!note) notFound();

  const title = note.title.trim() || "Untitled note";
  return (
    <main className="share-page">
      <article className="share-card">
        <header className="share-head">
          <h1>{title}</h1>
          <p className="share-meta">
            Updated {formatPrettyDate(new Date(note.updatedAt))}
          </p>
        </header>
        {note.notes.trim() ? (
          <MarkdownView markdown={note.notes} />
        ) : (
          <p className="share-empty">This note is empty.</p>
        )}
      </article>
      <footer className="share-foot">Shared from Meeting Hub</footer>
    </main>
  );
}
