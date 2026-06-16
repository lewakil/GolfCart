import { BatteryCharging, Clock, Gauge, MapPin, Route, Wrench } from "lucide-react";
import { BatteryBadge, StatusBadge } from "./StatusBadge.jsx";
import { formatMiles, formatPercent, formatRelativeTime, formatShortDateTime } from "../lib/formatters.js";

export function CartDetails({ cart }) {
  if (!cart) {
    return (
      <section className="panel detail-panel empty-detail">
        <h2>Cart Detail</h2>
        <p>Select a cart from the table or map.</p>
      </section>
    );
  }

  return (
    <section className="panel detail-panel">
      <div className="detail-header">
        <div>
          <h2>{cart.name}</h2>
          <p>{cart.assetId}</p>
        </div>
        <StatusBadge status={cart.status} />
      </div>

      <div className="detail-grid">
        <DetailItem icon={BatteryCharging} label="Battery" value={formatPercent(cart.batteryPercent)} subvalue={cart.batteryStatus}>
          <BatteryBadge label={cart.batteryStatus} percent={cart.batteryPercent} />
        </DetailItem>
        <DetailItem icon={Route} label="Trip" value={cart.tripStartAt ? cart.tripDuration : "No active trip"} subvalue={cart.expectedBack} />
        <DetailItem icon={Gauge} label="Utilization" value={formatPercent(cart.utilizationPercent)} subvalue={formatMiles(cart.odometerMiles, 0)} />
        <DetailItem icon={Wrench} label="Service" value={cart.maintenanceStatus} subvalue={serviceText(cart.serviceDueInDays)} />
        <DetailItem icon={Clock} label="Last seen" value={formatRelativeTime(cart.lastSeenAt)} subvalue={formatShortDateTime(cart.lastSeenAt)} />
        <DetailItem icon={MapPin} label="Location" value={coordinateText(cart.currentLocation)} subvalue={`${cart.speedMph ?? 0} mph`} />
      </div>

      <div className="detail-section">
        <h3>Route</h3>
        <div className="route-pills">
          {cart.routeSteps.length ? cart.routeSteps.map((step) => <span key={step}>{step}</span>) : <span>Route pending</span>}
        </div>
      </div>

      <div className="detail-section">
        <h3>Signals</h3>
        <ul className="signal-list">
          <li>
            <strong>Charging</strong>
            <span>{cart.chargeAge}</span>
          </li>
          <li>
            <strong>Geofence</strong>
            <span>{cart.noGoEntered ? cart.noGoDetail : cart.noGoStatus}</span>
          </li>
          <li>
            <strong>Lodging</strong>
            <span>{cart.lodgingAt ? cart.lodgingDetail : cart.lodgingStatus}</span>
          </li>
        </ul>
      </div>
    </section>
  );
}

function DetailItem({ children, icon: Icon, label, value, subvalue }) {
  return (
    <div className="detail-item">
      <Icon size={17} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{subvalue}</small>
      {children ? <div className="detail-extra">{children}</div> : null}
    </div>
  );
}

function serviceText(days) {
  if (!Number.isFinite(Number(days))) return "Not scheduled";
  if (days <= 0) return "Due today";
  return `Due in ${days} days`;
}

function coordinateText(location) {
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "No fix";
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}
