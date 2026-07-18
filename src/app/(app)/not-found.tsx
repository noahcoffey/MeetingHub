import Link from "next/link";

// Styled 404 for the authed route group (notFound() in meetings/[id] and
// projects/[id] lands here), rendered inside the app chrome.
export default function NotFound() {
  return (
    <div className="page">
      <div className="boundary-card">
        <h1 className="page-title">Not found</h1>
        <p className="muted">
          That page doesn&apos;t exist — it may have been deleted.
        </p>
        <div className="boundary-actions">
          <Link href="/" className="primary-btn">
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
