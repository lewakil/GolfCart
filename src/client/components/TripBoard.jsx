import { Flag, Route, Timer } from "lucide-react";
import { formatMiles, formatShortDateTime } from "../lib/formatters.js";
import { StatusBadge } from "./StatusBadge.jsx";

export function TripBoard({ carts, onSelectCart, selectedCartId }) {
  const activeTrips = carts.filter((cart) => cart.tripStartAt || cart.status === "return_pending");

  return (
    <section className="panel trip-board">
      <div className="panel-heading">
        <div>
          <h2>Current Trips</h2>
          <p>{activeTrips.length} active or returning</p>
        </div>
      </div>

      <div className="trip-grid">
        {activeTrips.map((cart) => (
          <button
            className={`trip-item ${selectedCartId === cart.assetId ? "selected" : ""}`}
            key={cart.assetId}
            onClick={() => onSelectCart(cart.assetId)}
            type="button"
          >
            <div className="trip-title">
              <strong>{cart.name}</strong>
              <StatusBadge status={cart.status} />
            </div>
            <div className="trip-stats">
              <span>
                <Timer size={15} />
                {cart.tripDuration}
              </span>
              <span>
                <Flag size={15} />
                {cart.holesCompleted}/9
              </span>
              <span>
                <Route size={15} />
                {formatMiles(cart.tripMilesDriven)}
              </span>
            </div>
            <div className="route-line">
              <span>{cart.routeSteps.length ? cart.routeSteps.join(" -> ") : "Route pending"}</span>
            </div>
            <dl>
              <div>
                <dt>Started</dt>
                <dd>{formatShortDateTime(cart.tripStartAt)}</dd>
              </div>
              <div>
                <dt>Next</dt>
                <dd>{cart.routeLikelyNext}</dd>
              </div>
              <div>
                <dt>Back</dt>
                <dd>{cart.expectedBack}</dd>
              </div>
            </dl>
          </button>
        ))}
      </div>
    </section>
  );
}
