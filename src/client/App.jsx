import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader } from "./components/AppHeader.jsx";
import { CartDetails } from "./components/CartDetails.jsx";
import { FleetMap } from "./components/FleetMap.jsx";
import { FleetTable } from "./components/FleetTable.jsx";
import { MetricStrip } from "./components/MetricStrip.jsx";
import { OperationsPanel } from "./components/OperationsPanel.jsx";
import { TripBoard } from "./components/TripBoard.jsx";
import { filterCarts, normalizeDashboard } from "./lib/dashboard.js";

export function App() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedCartId, setSelectedCartId] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadDashboard = useCallback(async ({ force = false } = {}) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(force ? "/api/dashboard?refresh=1" : "/api/dashboard");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Dashboard API request failed");
      const normalized = normalizeDashboard(payload);
      setDashboard(normalized);
      setSelectedCartId((current) => current || normalized.carts[0]?.assetId || null);
    } catch (requestError) {
      setError(requestError.message || String(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => loadDashboard(), 60_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, loadDashboard]);

  const visibleCarts = useMemo(() => (
    dashboard ? filterCarts(dashboard.carts, { query, status: statusFilter }) : []
  ), [dashboard, query, statusFilter]);
  const selectedCart = useMemo(() => (
    dashboard?.carts.find((cart) => cart.assetId === selectedCartId) || visibleCarts[0] || null
  ), [dashboard, selectedCartId, visibleCarts]);

  if (!dashboard && loading) {
    return <LoadingScreen />;
  }

  return (
    <div className="app-shell">
      <AppHeader
        autoRefresh={autoRefresh}
        dashboard={dashboard}
        loading={loading}
        onAutoRefreshChange={setAutoRefresh}
        onRefresh={() => loadDashboard({ force: true })}
      />

      {error ? (
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      {dashboard ? (
        <main>
          <MetricStrip summary={dashboard.summary} />

          <div className="workspace-grid">
            <FleetMap
              assets={dashboard.heatmapAssets}
              carts={dashboard.carts}
              onSelectCart={setSelectedCartId}
              selectedCartId={selectedCart?.assetId}
              sites={dashboard.sites || []}
            />
            <OperationsPanel dashboard={dashboard} onSelectCart={setSelectedCartId} />
          </div>

          <div className="fleet-detail-grid">
            <FleetTable
              carts={visibleCarts}
              onQueryChange={setQuery}
              onSelectCart={setSelectedCartId}
              onStatusFilterChange={setStatusFilter}
              query={query}
              selectedCartId={selectedCart?.assetId}
              statusFilter={statusFilter}
            />
            <CartDetails cart={selectedCart} />
          </div>

          <TripBoard carts={dashboard.carts} onSelectCart={setSelectedCartId} selectedCartId={selectedCart?.assetId} />
        </main>
      ) : (
        <EmptyAppState error={error} onRetry={() => loadDashboard({ force: true })} />
      )}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-mark" />
      <strong>Loading Golf Cart Tracker</strong>
      <span>Connecting to dashboard API</span>
    </div>
  );
}

function EmptyAppState({ error, onRetry }) {
  return (
    <main>
      <section className="panel empty-app-state">
        <AlertTriangle size={28} />
        <h2>Dashboard unavailable</h2>
        <p>{error || "The API did not return dashboard data."}</p>
        <button className="icon-button primary-action" onClick={onRetry} type="button">
          Retry
        </button>
      </section>
    </main>
  );
}
