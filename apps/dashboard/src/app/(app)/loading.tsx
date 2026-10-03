export default function AppLoading() {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      <div className="section-head">
        <div className="skeleton" style={{ height: "0.85rem", width: "7rem", marginBottom: "0.65rem" }} />
        <div className="skeleton" style={{ height: "1.75rem", width: "12rem", marginBottom: "0.55rem" }} />
        <div className="skeleton" style={{ height: "0.95rem", width: "min(28rem, 90%)" }} />
      </div>

      <div className="metric-grid">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="metric-card">
            <div className="skeleton" style={{ height: "0.75rem", width: "4.5rem", marginBottom: "0.85rem" }} />
            <div className="skeleton" style={{ height: "2rem", width: "5rem", marginBottom: "0.55rem" }} />
            <div className="skeleton" style={{ height: "0.75rem", width: "8rem" }} />
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="skeleton" style={{ height: "1.1rem", width: "9rem", marginBottom: "0.85rem" }} />
        <div className="skeleton" style={{ height: "0.9rem", width: "100%", marginBottom: "0.45rem" }} />
        <div className="skeleton" style={{ height: "0.9rem", width: "85%", marginBottom: "0.45rem" }} />
        <div className="skeleton" style={{ height: "0.9rem", width: "70%" }} />
      </div>
    </div>
  );
}
