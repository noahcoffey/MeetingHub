// Covers both a bad slug and a share that has since been turned off — the two
// are deliberately indistinguishable from outside.
export default function SharedNoteNotFound() {
  return (
    <main className="share-page">
      <article className="share-card">
        <header className="share-head">
          <h1>Link not available</h1>
          <p className="share-meta">
            This note isn’t shared, or the link has been turned off.
          </p>
        </header>
      </article>
      <footer className="share-foot">Shared from Meeting Hub</footer>
    </main>
  );
}
