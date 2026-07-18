"use client";

// Error boundary for the authed route group — keeps a DB hiccup or render
// failure inside the app chrome instead of Next's unstyled default page.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="page">
      <div className="boundary-card" role="alert">
        <h1 className="page-title">Something went wrong</h1>
        <p className="muted">
          The page failed to load. This is usually temporary — try again.
        </p>
        {error.digest && (
          <p className="muted boundary-digest">Error reference: {error.digest}</p>
        )}
        <div className="boundary-actions">
          <button type="button" className="primary-btn" onClick={() => reset()}>
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
