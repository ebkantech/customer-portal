/** Small presentational pieces shared by the customer dashboard. */

export type Section<T> =
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "ready"; data: T };

export function Status({ value }: { value: string }) {
  const v = value.toLowerCase();
  const cls = /paid|complete|active|approved|delivered|closed|valid|covered/.test(v)
    ? "status-good"
    : /overdue|reject|cancel|fail|expired/.test(v)
      ? "status-bad"
      : /pending|progress|open|process|link sent|unpaid|due/.test(v)
        ? "status-warn"
        : "status-neutral";
  return (
    <span className={`status-pill ${cls}`}>
      <i aria-hidden="true" />
      {value}
    </span>
  );
}

export function Empty({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">
        {icon}
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

export function SectionError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="empty-state error-state" role="alert">
      <div className="empty-icon" aria-hidden="true">
        !
      </div>
      <h3>This section couldn&apos;t be loaded</h3>
      <p>{message}</p>
      <button type="button" className="button button-outline" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function SkeletonRows({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="skeleton-list" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <span className="skeleton skeleton-block" />
          <span className="skeleton-lines">
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line short" />
          </span>
        </div>
      ))}
    </div>
  );
}

export function StatCard({
  label,
  value,
  note,
  icon,
  tone,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  note: string;
  icon: string;
  tone: string;
  loading?: boolean;
}) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`} aria-hidden="true">
        {icon}
      </div>
      <span className="stat-label">{label}</span>
      {loading ? (
        <span className="skeleton skeleton-stat" aria-label={`Loading ${label}`} />
      ) : (
        <strong className="stat-value">{value}</strong>
      )}
      <span className="stat-note">{note}</span>
    </div>
  );
}

export function ProfileRow({ label, value }: { label: string; value?: unknown }) {
  return (
    <div className="profile-row">
      <span>{label}</span>
      <strong>{typeof value === "string" && value ? value : "Not provided"}</strong>
    </div>
  );
}
