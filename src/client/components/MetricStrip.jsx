import { AlertTriangle, BatteryCharging, Gauge, MapPinned, Wrench } from "lucide-react";
import { formatPercent } from "../lib/formatters.js";

export function MetricStrip({ summary }) {
  const metrics = [
    {
      icon: MapPinned,
      label: "Available",
      value: `${summary.available ?? 0}/${summary.total ?? 0}`,
      subvalue: `${summary.active ?? 0} active`,
      tone: "success",
    },
    {
      icon: BatteryCharging,
      label: "Avg battery",
      value: formatPercent(summary.average_battery_percent),
      subvalue: `${summary.needs_charge ?? 0} need charge`,
      tone: summary.needs_charge ? "warning" : "info",
    },
    {
      icon: AlertTriangle,
      label: "Open alerts",
      value: summary.open_alerts ?? 0,
      subvalue: "geofence and ops",
      tone: summary.open_alerts ? "danger" : "success",
    },
    {
      icon: Wrench,
      label: "Maintenance",
      value: summary.maintenance ?? 0,
      subvalue: "in service bay",
      tone: summary.maintenance ? "neutral" : "success",
    },
    {
      icon: Gauge,
      label: "Utilization",
      value: formatPercent(summary.utilization_percent),
      subvalue: "fleet average",
      tone: "info",
    },
  ];

  return (
    <section className="metric-strip" aria-label="Fleet metrics">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <article className={`metric-card metric-${metric.tone}`} key={metric.label}>
            <Icon size={20} aria-hidden="true" />
            <div>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.subvalue}</small>
            </div>
          </article>
        );
      })}
    </section>
  );
}
