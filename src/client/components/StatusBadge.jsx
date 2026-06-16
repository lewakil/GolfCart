import { alertTone, batteryTone, statusLabel, statusTone } from "../lib/formatters.js";

export function StatusBadge({ status }) {
  return <span className={`badge badge-${statusTone(status)}`}>{statusLabel(status)}</span>;
}

export function BatteryBadge({ percent, label }) {
  const tone = batteryTone(percent);
  return <span className={`badge badge-${tone}`}>{label || `${percent ?? "-"}%`}</span>;
}

export function AlertBadge({ severity }) {
  return <span className={`badge badge-${alertTone(severity)}`}>{severity || "info"}</span>;
}
