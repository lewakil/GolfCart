import { AlertTriangle, BatteryCharging, CalendarClock, Wrench } from "lucide-react";
import { AlertBadge } from "./StatusBadge.jsx";
import { formatMiles, formatRelativeTime, formatShortDateTime } from "../lib/formatters.js";

export function OperationsPanel({ dashboard, onSelectCart }) {
  return (
    <aside className="operations-panel">
      <section className="panel queue-panel">
        <PanelTitle icon={AlertTriangle} title="Alerts" />
        <div className="stack-list">
          {dashboard.alerts.length ? dashboard.alerts.map((alert) => (
            <button className="stack-row" key={alert.id} onClick={() => onSelectCart(alert.asset_id)} type="button">
              <div>
                <strong>{alert.title}</strong>
                <span>{alert.message}</span>
              </div>
              <div className="stack-meta">
                <AlertBadge severity={alert.severity} />
                <small>{formatRelativeTime(alert.timestamp)}</small>
              </div>
            </button>
          )) : <EmptyLine text="No open alerts" />}
        </div>
      </section>

      <section className="panel queue-panel">
        <PanelTitle icon={Wrench} title="Maintenance" />
        <div className="stack-list">
          {dashboard.maintenanceQueue.length ? dashboard.maintenanceQueue.map((item) => (
            <button className="stack-row" key={`${item.asset_id}-${item.task}`} onClick={() => onSelectCart(item.asset_id)} type="button">
              <div>
                <strong>{item.name}</strong>
                <span>{item.task}</span>
              </div>
              <div className="stack-meta">
                <span className={`badge ${item.priority === "high" ? "badge-danger" : "badge-neutral"}`}>{item.due}</span>
                <small>{formatMiles(item.odometer_miles, 0)}</small>
              </div>
            </button>
          )) : <EmptyLine text="Maintenance queue clear" />}
        </div>
      </section>

      <section className="panel queue-panel">
        <PanelTitle icon={BatteryCharging} title="Charging" />
        <div className="insight-block">
          <strong>{dashboard.charging_insights?.recommendation || "Charging insight unavailable"}</strong>
          <span>{cartList("Low battery", dashboard.charging_insights?.low_battery_carts)}</span>
          <span>{cartList("Stale charge", dashboard.charging_insights?.stale_charge_carts)}</span>
        </div>
      </section>

      <section className="panel queue-panel">
        <PanelTitle icon={CalendarClock} title="Reservations" />
        <div className="stack-list">
          {dashboard.reservations.length ? dashboard.reservations.map((reservation) => (
            <div className="stack-row static-row" key={reservation.id}>
              <div>
                <strong>{reservation.group}</strong>
                <span>{reservation.carts_needed} carts needed</span>
              </div>
              <div className="stack-meta">
                <span className="badge badge-info">{reservation.status}</span>
                <small>{formatShortDateTime(reservation.starts_at)}</small>
              </div>
            </div>
          )) : <EmptyLine text="No upcoming reservations" />}
        </div>
      </section>
    </aside>
  );
}

function PanelTitle({ icon: Icon, title }) {
  return (
    <div className="mini-heading">
      <Icon size={17} aria-hidden="true" />
      <h3>{title}</h3>
    </div>
  );
}

function EmptyLine({ text }) {
  return <div className="empty-line">{text}</div>;
}

function cartList(label, carts = []) {
  return `${label}: ${carts.length ? carts.join(", ") : "none"}`;
}
