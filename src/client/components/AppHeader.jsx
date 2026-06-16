import { Activity, RefreshCw, Satellite, ToggleLeft, ToggleRight } from "lucide-react";
import { formatRelativeTime, formatShortDateTime } from "../lib/formatters.js";

export function AppHeader({ dashboard, loading, autoRefresh, onAutoRefreshChange, onRefresh }) {
  const provider = dashboard?.provider || "demo";
  const generatedAt = dashboard?.generated_at;

  return (
    <header className="app-header">
      <div className="brand-block">
        <div className="brand-mark" aria-hidden="true">
          <Activity size={22} />
        </div>
        <div>
          <h1>Golf Cart Tracker</h1>
          <p>
            <Satellite size={14} aria-hidden="true" />
            <span>{providerLabel(provider)}</span>
            <span>{generatedAt ? `Updated ${formatRelativeTime(generatedAt)}` : "Waiting for telemetry"}</span>
            <span>{generatedAt ? formatShortDateTime(generatedAt) : "-"}</span>
          </p>
        </div>
      </div>

      <div className="header-actions">
        <label className="toggle-control">
          <input
            checked={autoRefresh}
            onChange={(event) => onAutoRefreshChange(event.target.checked)}
            type="checkbox"
          />
          {autoRefresh ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
          <span>Auto refresh</span>
        </label>
        <button className="icon-button primary-action" disabled={loading} onClick={onRefresh} title="Refresh dashboard" type="button">
          <RefreshCw className={loading ? "spin" : ""} size={18} />
          <span>Refresh</span>
        </button>
      </div>
    </header>
  );
}

function providerLabel(provider) {
  return provider === "trackunit" ? "Live telemetry" : "Demo telemetry";
}
