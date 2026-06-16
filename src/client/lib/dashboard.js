export function normalizeDashboard(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const tripRows = Array.isArray(payload?.trip_rows) ? payload.trip_rows : [];
  const heatmapAssets = Array.isArray(payload?.heatmap_assets) ? payload.heatmap_assets : [];
  const tripByAsset = new Map(tripRows.map((row) => [row.asset_id, row]));
  const assetById = new Map(heatmapAssets.map((asset) => [asset.asset_id, asset]));
  const carts = rows.map((row) => normalizeCart(row, tripByAsset.get(row.asset_id), assetById.get(row.asset_id)));

  return {
    ...payload,
    carts,
    tripRows,
    heatmapAssets,
    summary: payload?.fleet_summary || deriveSummary(carts, payload?.alerts || []),
    alerts: Array.isArray(payload?.alerts) ? payload.alerts : deriveAlerts(carts),
    maintenanceQueue: Array.isArray(payload?.maintenance_queue) ? payload.maintenance_queue : deriveMaintenanceQueue(carts),
    reservations: Array.isArray(payload?.reservations) ? payload.reservations : [],
  };
}

export function filterCarts(carts, { query, status }) {
  const q = query.trim().toLowerCase();
  return carts.filter((cart) => {
    const matchesQuery = !q || [cart.name, cart.assetId, cart.assignedGroup, cart.statusDetail]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
    const matchesStatus = status === "all" || cart.status === status;
    return matchesQuery && matchesStatus;
  });
}

function normalizeCart(row, tripRow, heatmapAsset) {
  const currentLocation = row.current_location || heatmapAsset?.current_location || null;
  const batteryPercent = numeric(row.battery_percent);
  const utilizationPercent = numeric(row.utilization_percent);
  const serviceDueInDays = numeric(row.service_due_in_days);

  return {
    raw: row,
    trip: tripRow || null,
    assetId: row.asset_id,
    name: row.name || row.asset_id || "Unknown cart",
    status: row.status || "unknown",
    statusDetail: row.status_detail || row.calculation_note || "",
    assignedGroup: row.assigned_group || (row.trip_start_at ? "Active trip" : "Fleet"),
    batteryPercent,
    batteryStatus: row.battery_status || batteryLabel(batteryPercent),
    utilizationPercent,
    odometerMiles: numeric(row.odometer_miles),
    serviceDueInDays,
    maintenanceStatus: row.maintenance_status || maintenanceLabel(serviceDueInDays),
    noGoEntered: Boolean(row.no_go_entered),
    noGoStatus: row.no_go_status || "Clear",
    noGoDetail: row.no_go_detail || "",
    lodgingAt: Boolean(row.apartment_at),
    lodgingStatus: row.apartment_status || "Clear",
    lodgingDetail: row.apartment_detail || "",
    tripStartAt: row.trip_start_at || null,
    tripDuration: row.trip_duration || tripRow?.trip_duration || "-",
    holesCompleted: numeric(row.holes_completed_count) || 0,
    holesLabel: row.holes_completed || "-",
    routeSteps: Array.isArray(row.route_steps) ? row.route_steps : [],
    routeLikelyNext: row.route_likely_next || "-",
    expectedBack: row.expected_back || "-",
    milesDriven: numeric(row.miles_driven),
    tripMilesDriven: numeric(row.trip_miles_driven ?? tripRow?.miles_driven),
    chargeAge: row.time_since_last_charging || "-",
    chargeAgeMinutes: numeric(row.time_since_last_charging_minutes),
    lastSeenAt: row.last_seen_at || currentLocation?.updatedAt || null,
    speedMph: numeric(row.speed_mph ?? currentLocation?.speed),
    currentLocation,
    points: Array.isArray(heatmapAsset?.points) ? heatmapAsset.points : [],
  };
}

function deriveSummary(carts, alerts) {
  const total = carts.length;
  const available = carts.filter((cart) => cart.status === "on_lot").length;
  const active = carts.filter((cart) => cart.status === "out" || cart.status === "return_pending").length;
  const maintenance = carts.filter((cart) => cart.status === "maintenance").length;
  const needsCharge = carts.filter((cart) => Number(cart.batteryPercent) <= 30).length;
  const batteries = carts.map((cart) => Number(cart.batteryPercent)).filter(Number.isFinite);
  const utilization = carts.map((cart) => Number(cart.utilizationPercent)).filter(Number.isFinite);

  return {
    total,
    available,
    active,
    maintenance,
    needs_charge: needsCharge,
    open_alerts: alerts.length,
    average_battery_percent: average(batteries),
    utilization_percent: average(utilization),
  };
}

function deriveAlerts(carts) {
  return carts.flatMap((cart) => {
    const alerts = [];
    if (cart.noGoEntered) {
      alerts.push({
        id: `no-go-${cart.assetId}`,
        severity: "critical",
        type: "geofence",
        asset_id: cart.assetId,
        title: "No-go zone entry",
        message: `${cart.name}: ${cart.noGoDetail || "No-go event detected"}`,
        timestamp: cart.lastSeenAt,
      });
    }
    if (Number(cart.batteryPercent) <= 25) {
      alerts.push({
        id: `battery-${cart.assetId}`,
        severity: "warning",
        type: "battery",
        asset_id: cart.assetId,
        title: "Low battery",
        message: `${cart.name} is at ${cart.batteryPercent}% battery.`,
        timestamp: cart.lastSeenAt,
      });
    }
    return alerts;
  });
}

function deriveMaintenanceQueue(carts) {
  return carts
    .filter((cart) => cart.status === "maintenance" || Number(cart.serviceDueInDays) <= 7)
    .map((cart) => ({
      asset_id: cart.assetId,
      name: cart.name,
      priority: Number(cart.serviceDueInDays) <= 1 ? "high" : "normal",
      task: cart.maintenanceStatus || "Safety check",
      status: cart.status === "maintenance" ? "In bay" : "Queued",
      due: Number.isFinite(Number(cart.serviceDueInDays)) ? `${cart.serviceDueInDays} days` : "-",
      odometer_miles: cart.odometerMiles,
    }));
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function average(values) {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function batteryLabel(percent) {
  const value = numeric(percent);
  if (value === null) return "Unknown";
  if (value <= 25) return "Critical";
  if (value <= 40) return "Low";
  if (value >= 85) return "Charged";
  return "Healthy";
}

function maintenanceLabel(days) {
  const value = numeric(days);
  if (value === null) return "Not scheduled";
  if (value <= 0) return "Due today";
  if (value <= 7) return "Due soon";
  return "Clear";
}
