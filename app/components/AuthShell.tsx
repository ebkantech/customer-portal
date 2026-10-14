/** The branded two-panel layout shared by the sign-in screens (gate and OTP form). */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-decoration">
        <div className="auth-glow" />
        <div className="auth-decoration-content">
          <div className="brand-mark light">
            V<span>+</span>
          </div>
          <p className="eyebrow light-text">VANTAGE COMPUTERS</p>
          <h1>
            Service that
            <br />
            <em>stays connected.</em>
          </h1>
          <p>One secure place for your customer account.</p>
          <div className="auth-feature">
            <span>01</span> Purchases & invoices
          </div>
          <div className="auth-feature">
            <span>02</span> Rentals & payments
          </div>
          <div className="auth-feature">
            <span>03</span> Repairs & warranties
          </div>
        </div>
      </div>
      <section className="auth-form-wrap">
        <div className="auth-form-card">
          <div className="security-icon" aria-hidden="true">
            ⌁
          </div>
          <p className="eyebrow">SECURE CUSTOMER ACCESS</p>
          {children}
        </div>
        <p className="copyright">
          © {new Date().getFullYear()} Vantage Computers · Customer Portal
        </p>
      </section>
    </main>
  );
}

export function StateAlert({
  title,
  tone = "error",
  children,
}: {
  title: string;
  tone?: "error" | "warning";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`alert ${tone === "error" ? "error-alert" : "warn-alert"}`}
      role="alert"
    >
      <strong>{title}</strong>
      {children}
    </div>
  );
}
