export function formatNumber(value, digits = 0) {
  const number = toFiniteNumber(value);
  if (number === null) return "-";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(number);
}

export function formatPercent(value) {
  const number = toFiniteNumber(value);
  if (number === null) return "-";
  return `${Math.round(number)}%`;
}

export function formatMiles(value, digits = 1) {
  const number = toFiniteNumber(value);
  if (number === null) return "-";
  return `${formatNumber(number, digits)} mi`;
}

export function formatShortDateTime(value) {
  const date = parseDate(value);
  if (!date) return "-";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelativeTime(value, now = new Date()) {
  const date = parseDate(value);
  if (!date) return "-";
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}m ago` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function statusLabel(status) {
  const labels = {
    maintenance: "Maintenance",
    on_lot: "On lot",
    out: "Out",
    return_pending: "Return pending",
    unknown: "Unknown",
  };
  return labels[status] || "Unknown";
}

export function statusTone(status) {
  if (status === "on_lot") return "success";
  if (status === "return_pending") return "warning";
  if (status === "maintenance") return "neutral";
  if (status === "out") return "info";
  return "muted";
}

export function batteryTone(percent) {
  const value = toFiniteNumber(percent);
  if (value === null) return "muted";
  if (value <= 25) return "danger";
  if (value <= 40) return "warning";
  if (value >= 85) return "success";
  return "info";
}

export function alertTone(severity) {
  if (severity === "critical") return "danger";
  if (severity === "warning") return "warning";
  return "info";
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
