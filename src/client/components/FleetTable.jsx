import { Search } from "lucide-react";
import { BatteryBadge, StatusBadge } from "./StatusBadge.jsx";
import { formatMiles, formatPercent, formatRelativeTime, statusLabel } from "../lib/formatters.js";

const FILTERS = ["all", "on_lot", "out", "return_pending", "maintenance"];

export function FleetTable({
  carts,
  query,
  statusFilter,
  selectedCartId,
  onQueryChange,
  onSelectCart,
  onStatusFilterChange,
}) {
  return (
    <section className="panel fleet-panel">
      <div className="panel-heading">
        <div>
          <h2>Fleet</h2>
          <p>{carts.length} carts in view</p>
        </div>
        <div className="table-tools">
          <label className="search-box">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Search carts"
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search carts"
              type="search"
              value={query}
            />
          </label>
          <div className="segmented-control" role="tablist" aria-label="Filter by status">
            {FILTERS.map((filter) => (
              <button
                aria-selected={statusFilter === filter}
                className={statusFilter === filter ? "active" : ""}
                key={filter}
                onClick={() => onStatusFilterChange(filter)}
                type="button"
              >
                {filter === "all" ? "All" : statusLabel(filter)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="fleet-table">
          <thead>
            <tr>
              <th>Cart</th>
              <th>Status</th>
              <th>Battery</th>
              <th>Assignment</th>
              <th>Trip</th>
              <th>Miles</th>
              <th>Service</th>
              <th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {carts.map((cart) => (
              <tr className={selectedCartId === cart.assetId ? "selected-row" : ""} key={cart.assetId}>
                <td>
                  <button className="row-link" onClick={() => onSelectCart(cart.assetId)} type="button">
                    <strong>{cart.name}</strong>
                    <span>{cart.assetId}</span>
                  </button>
                </td>
                <td>
                  <StatusBadge status={cart.status} />
                  <small>{cart.statusDetail}</small>
                </td>
                <td>
                  <div className="battery-cell">
                    <BatteryBadge label={cart.batteryStatus} percent={cart.batteryPercent} />
                    <div className="meter" aria-label={`${cart.batteryPercent ?? 0}% battery`}>
                      <span style={{ width: `${Math.max(0, Math.min(100, cart.batteryPercent || 0))}%` }} />
                    </div>
                    <small>{formatPercent(cart.batteryPercent)}</small>
                  </div>
                </td>
                <td>
                  <strong>{cart.assignedGroup}</strong>
                  <small>{cart.lodgingAt ? cart.lodgingDetail : cart.lodgingStatus}</small>
                </td>
                <td>
                  <strong>{cart.tripStartAt ? cart.tripDuration : "No active trip"}</strong>
                  <small>{cart.expectedBack !== "-" ? `Expected ${cart.expectedBack}` : cart.routeLikelyNext}</small>
                </td>
                <td>
                  <strong>{formatMiles(cart.milesDriven)}</strong>
                  <small>{cart.tripMilesDriven ? `${formatMiles(cart.tripMilesDriven)} trip` : "lookback"}</small>
                </td>
                <td>
                  <strong>{cart.maintenanceStatus}</strong>
                  <small>{serviceDueText(cart.serviceDueInDays)}</small>
                </td>
                <td>{formatRelativeTime(cart.lastSeenAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function serviceDueText(days) {
  if (!Number.isFinite(Number(days))) return "Not scheduled";
  if (days <= 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}
