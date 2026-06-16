const RETURN_BUFFER_MINUTES = 20;
const LOOKBACK_LABEL = "14 days";
const HOLES_PER_LOOP = 9;

const COURSE_POINTS = {
  start: point(33.49372, -111.93248),
  hole1: point(33.4963, -111.9352),
  hole2: point(33.4991, -111.9375),
  hole3: point(33.5022, -111.9361),
  hole4: point(33.5046, -111.9328),
  hole5: point(33.5036, -111.9286),
  hole6: point(33.5002, -111.9269),
  hole7: point(33.4974, -111.9283),
  hole8: point(33.4956, -111.9304),
  hole9: point(33.4942, -111.9315),
  noGoLake: point(33.50295, -111.92958),
  noGoService: point(33.4922, -111.9367),
  lodging: point(33.49085, -111.92865),
};

const DEMO_SITES = [
  site("site-start", "Start / Stop Lot", "DEPOT", COURSE_POINTS.start, 0.0011, 0.0013),
  site("site-lake", "Lake Edge No-Go", "NO_GO", COURSE_POINTS.noGoLake, 0.0009, 0.001),
  site("site-service", "Service Yard No-Go", "NO_GO", COURSE_POINTS.noGoService, 0.0009, 0.0011),
  site("site-lodging", "Clubhouse Lodging", "LODGING", COURSE_POINTS.lodging, 0.0009, 0.001),
  ...Array.from({ length: HOLES_PER_LOOP }, (_, index) => {
    const hole = index + 1;
    return site(`site-hole-${hole}`, `North ${hole}`, "HOLE", COURSE_POINTS[`hole${hole}`], 0.00075, 0.0009, {
      course: "North",
      hole,
    });
  }),
];

export class DemoDashboardProvider {
  constructor({ lookbackHours = 14 * 24 } = {}) {
    this.lookbackHours = lookbackHours;
  }

  async dashboard() {
    const generatedAt = new Date();
    const rows = buildDemoRows(generatedAt);
    const tripRows = rows.map((row) => buildTripRow(row, generatedAt));
    const heatmapAssets = rows.map((row) => buildHeatmapAsset(row, generatedAt));
    const noGoEvents = buildNoGoEvents(generatedAt);
    const alerts = buildAlerts(rows, generatedAt);
    const maintenanceQueue = buildMaintenanceQueue(rows, generatedAt);

    return {
      provider: "demo",
      generated_at: iso(generatedAt),
      lookback_hours: this.lookbackHours,
      lookback_label: LOOKBACK_LABEL,
      return_buffer_minutes: RETURN_BUFFER_MINUTES,
      fleet_summary: buildFleetSummary(rows, alerts),
      alerts,
      maintenance_queue: maintenanceQueue,
      reservations: buildReservations(generatedAt),
      sites: DEMO_SITES,
      rows,
      trip_rows: tripRows,
      heatmap_assets: heatmapAssets,
      heatmap_mode: "demo_history",
      heatmap_note: "Demo telemetry generated locally for portfolio review and UI testing.",
      heatmap_point_count: heatmapAssets.reduce((total, asset) => total + asset.points.length, 0),
      no_go_events: noGoEvents,
      no_go_recent_events: noGoEvents,
      no_go_summary: buildNoGoSummary(noGoEvents),
      no_go_history_note: "Demo no-go events are deterministic and reset with each server restart.",
      trip_history_summary: {
        active_count: rows.filter((row) => row.trip_start_at).length,
        completed_count: 42,
        trips_with_charge_after_return: 36,
      },
      charging_insights: buildChargingInsights(rows),
      warning: null,
    };
  }
}

function buildDemoRows(generatedAt) {
  return [
    demoCart({
      assetId: "cart-014",
      name: "Cart 014",
      status: "on_lot",
      statusDetail: "Ready in Start / Stop",
      batteryPercent: 96,
      chargeMinutesAgo: 34,
      milesDriven: 12.4,
      utilizationPercent: 28,
      odometerMiles: 821,
      serviceDueInDays: 19,
      routeAnchors: [COURSE_POINTS.start],
      assignedGroup: "Available",
      generatedAt,
    }),
    demoCart({
      assetId: "cart-027",
      name: "Cart 027",
      status: "out",
      statusDetail: "On active guest round",
      batteryPercent: 62,
      chargeMinutesAgo: 178,
      holesCompleted: 5,
      milesDriven: 18.9,
      tripMiles: 4.8,
      utilizationPercent: 74,
      odometerMiles: 1264,
      serviceDueInDays: 8,
      tripStartedMinutesAgo: 92,
      routeAnchors: [COURSE_POINTS.start, COURSE_POINTS.hole1, COURSE_POINTS.hole2, COURSE_POINTS.hole3, COURSE_POINTS.hole4, COURSE_POINTS.hole5],
      assignedGroup: "Guest round",
      expectedBack: "~1h 00m",
      generatedAt,
    }),
    demoCart({
      assetId: "cart-033",
      name: "Cart 033",
      status: "return_pending",
      statusDetail: "Inside Start / Stop, confirming return buffer",
      batteryPercent: 38,
      chargeMinutesAgo: 248,
      holesCompleted: 9,
      milesDriven: 21.2,
      tripMiles: 7.4,
      utilizationPercent: 81,
      odometerMiles: 1579,
      serviceDueInDays: 3,
      tripStartedMinutesAgo: 166,
      routeAnchors: [
        COURSE_POINTS.start,
        COURSE_POINTS.hole1,
        COURSE_POINTS.hole2,
        COURSE_POINTS.hole3,
        COURSE_POINTS.hole4,
        COURSE_POINTS.hole5,
        COURSE_POINTS.hole6,
        COURSE_POINTS.hole7,
        COURSE_POINTS.hole8,
        COURSE_POINTS.hole9,
        COURSE_POINTS.start,
      ],
      assignedGroup: "Guest round",
      expectedBack: "Soon",
      generatedAt,
    }),
    demoCart({
      assetId: "cart-041",
      name: "Cart 041",
      status: "out",
      statusDetail: "Entered restricted lake edge zone",
      batteryPercent: 22,
      chargeMinutesAgo: 412,
      holesCompleted: 6,
      milesDriven: 26.6,
      tripMiles: 5.9,
      utilizationPercent: 89,
      odometerMiles: 2018,
      serviceDueInDays: 1,
      tripStartedMinutesAgo: 121,
      routeAnchors: [
        COURSE_POINTS.start,
        COURSE_POINTS.hole1,
        COURSE_POINTS.hole2,
        COURSE_POINTS.hole3,
        COURSE_POINTS.hole4,
        COURSE_POINTS.hole5,
        COURSE_POINTS.noGoLake,
      ],
      assignedGroup: "Marshal review",
      noGoEntered: true,
      noGoStatus: "Entered",
      noGoDetail: "Lake Edge No-Go · latest 18m ago",
      expectedBack: "~45m",
      generatedAt,
    }),
    demoCart({
      assetId: "cart-052",
      name: "Cart 052",
      status: "maintenance",
      statusDetail: "Pulled for brake inspection",
      batteryPercent: 71,
      chargeMinutesAgo: 92,
      milesDriven: 5.1,
      utilizationPercent: 12,
      odometerMiles: 2441,
      serviceDueInDays: 0,
      routeAnchors: [COURSE_POINTS.start, COURSE_POINTS.noGoService],
      assignedGroup: "Maintenance",
      maintenanceStatus: "Brake inspection today",
      generatedAt,
    }),
    demoCart({
      assetId: "cart-064",
      name: "Cart 064",
      status: "out",
      statusDetail: "At lodging pickup zone",
      batteryPercent: 54,
      chargeMinutesAgo: 156,
      holesCompleted: 2,
      milesDriven: 9.7,
      tripMiles: 2.1,
      utilizationPercent: 46,
      odometerMiles: 538,
      serviceDueInDays: 25,
      tripStartedMinutesAgo: 44,
      routeAnchors: [COURSE_POINTS.start, COURSE_POINTS.lodging, COURSE_POINTS.hole1, COURSE_POINTS.hole2],
      assignedGroup: "Lodging shuttle",
      apartmentAt: true,
      apartmentStatus: "At lodging",
      apartmentDetail: "Clubhouse Lodging",
      expectedBack: "~1h 45m",
      generatedAt,
    }),
  ];
}

function demoCart(config) {
  const {
    assetId,
    name,
    status,
    statusDetail,
    batteryPercent,
    chargeMinutesAgo,
    holesCompleted = 0,
    milesDriven,
    tripMiles = null,
    utilizationPercent,
    odometerMiles,
    serviceDueInDays,
    routeAnchors,
    assignedGroup,
    generatedAt,
    tripStartedMinutesAgo = null,
    noGoEntered = false,
    noGoStatus = "Clear",
    noGoDetail = "No no-go hits",
    apartmentAt = false,
    apartmentStatus = "Clear",
    apartmentDetail = "Not in lodging zone",
    maintenanceStatus = "Clear",
    expectedBack = "-",
  } = config;

  const tripStartAt = tripStartedMinutesAgo ? iso(minutesAgo(generatedAt, tripStartedMinutesAgo)) : null;
  const points = routePoints(routeAnchors, generatedAt, tripStartedMinutesAgo || 45);
  const currentPoint = points.at(-1) || routeAnchors.at(-1);
  const routeSteps = Array.from({ length: holesCompleted }, (_, index) => `North ${index + 1}`);
  const speedMph = status === "out" ? 8 : status === "return_pending" ? 1 : 0;

  return {
    asset_id: assetId,
    name,
    status,
    status_detail: statusDetail,
    assigned_group: assignedGroup,
    battery_percent: batteryPercent,
    battery_status: batteryStatus(batteryPercent),
    utilization_percent: utilizationPercent,
    odometer_miles: odometerMiles,
    service_due_in_days: serviceDueInDays,
    maintenance_status: maintenanceStatus,
    no_go_entered: noGoEntered,
    no_go_status: noGoStatus,
    no_go_detail: noGoDetail,
    apartment_at: apartmentAt,
    apartment_status: apartmentStatus,
    apartment_detail: apartmentDetail,
    trip_start_at: tripStartAt,
    trip_duration: tripStartAt ? durationFromMinutes(tripStartedMinutesAgo) : "-",
    holes_completed: holesCompleted ? `North ${holesCompleted}/${HOLES_PER_LOOP}` : "-",
    holes_completed_count: holesCompleted,
    holes_completed_detail: holesCompleted ? "Demo route inferred from GPS trail" : "No active route",
    route_steps: routeSteps,
    route_likely_next: holesCompleted >= HOLES_PER_LOOP ? "Start / Stop" : `North ${holesCompleted + 1}`,
    route_return_estimate: expectedBack,
    miles_driven: milesDriven,
    trip_miles_driven: tripMiles,
    time_since_last_charging: estimateMinutes(chargeMinutesAgo),
    time_since_last_charging_minutes: chargeMinutesAgo,
    expected_back: expectedBack,
    expected_back_detail: expectedBack === "-" ? "No active trip" : "15 min/hole demo estimate",
    last_seen_at: iso(minutesAgo(generatedAt, status === "maintenance" ? 14 : 2)),
    speed_mph: speedMph,
    current_location: latestLocation(currentPoint, generatedAt, speedMph),
    points,
  };
}

function buildTripRow(row, generatedAt) {
  const hasTrip = Boolean(row.trip_start_at);
  return {
    asset_id: row.asset_id,
    name: row.name,
    status: row.status,
    status_label: statusLabel(row.status),
    trip_start_at: row.trip_start_at,
    trip_duration: hasTrip ? row.trip_duration : "-",
    holes_completed: row.holes_completed,
    holes_completed_count: row.holes_completed_count,
    holes_completed_detail: row.holes_completed_detail,
    route_steps: row.route_steps,
    route_likely_next: hasTrip ? row.route_likely_next : "-",
    route_return_estimate: row.route_return_estimate,
    no_go_entered: row.no_go_entered,
    no_go_status: row.no_go_status,
    no_go_detail: row.no_go_detail,
    no_go_events: row.no_go_entered
      ? [{
          site_name: "Lake Edge No-Go",
          timestamp: iso(minutesAgo(generatedAt, 18)),
          latitude: COURSE_POINTS.noGoLake.latitude,
          longitude: COURSE_POINTS.noGoLake.longitude,
        }]
      : [],
    miles_driven: row.trip_miles_driven,
    expected_back: row.expected_back,
    battery_percent: row.battery_percent,
    calculation_note: hasTrip
      ? "Demo active trip closes after the return buffer is satisfied."
      : "No active trip.",
  };
}

function buildHeatmapAsset(row, generatedAt) {
  return {
    asset_id: row.asset_id,
    name: row.name,
    points: row.points,
    current_location: row.current_location || latestLocation(row.points.at(-1), generatedAt, row.speed_mph),
    heatmap_source: "demo_route",
  };
}

function buildNoGoEvents(generatedAt) {
  return [
    {
      asset_id: "cart-041",
      asset_name: "Cart 041",
      site_id: "site-lake",
      site_name: "Lake Edge No-Go",
      event_type: "entry",
      timestamp: iso(minutesAgo(generatedAt, 18)),
      latitude: COURSE_POINTS.noGoLake.latitude,
      longitude: COURSE_POINTS.noGoLake.longitude,
    },
  ];
}

function buildNoGoSummary(events) {
  const zones = ["Lake Edge No-Go", "Service Yard No-Go"];
  return zones.map((zone) => {
    const zoneEvents = events.filter((event) => event.site_name === zone);
    return {
      site_name: zone,
      entry_count: zoneEvents.filter((event) => event.event_type === "entry").length,
      exit_count: zoneEvents.filter((event) => event.event_type === "exit").length,
      carts: [...new Set(zoneEvents.map((event) => event.asset_name))],
      last_event_at: zoneEvents.at(-1)?.timestamp || null,
      last_event_type: zoneEvents.at(-1)?.event_type || null,
    };
  });
}

function buildFleetSummary(rows, alerts) {
  const byStatus = rows.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, {});

  return {
    total: rows.length,
    available: byStatus.on_lot || 0,
    active: (byStatus.out || 0) + (byStatus.return_pending || 0),
    maintenance: byStatus.maintenance || 0,
    needs_charge: rows.filter((row) => row.battery_percent <= 30).length,
    open_alerts: alerts.length,
    average_battery_percent: Math.round(rows.reduce((sum, row) => sum + row.battery_percent, 0) / rows.length),
    utilization_percent: Math.round(rows.reduce((sum, row) => sum + row.utilization_percent, 0) / rows.length),
  };
}

function buildAlerts(rows, generatedAt) {
  const alerts = [];
  const lowBattery = rows.find((row) => row.battery_percent <= 25);
  const noGo = rows.find((row) => row.no_go_entered);
  const dueMaintenance = rows.find((row) => row.service_due_in_days === 0);
  const returnPending = rows.find((row) => row.status === "return_pending");

  if (noGo) {
    alerts.push({
      id: "alert-no-go-cart-041",
      severity: "critical",
      type: "geofence",
      asset_id: noGo.asset_id,
      title: "No-go zone entry",
      message: `${noGo.name} entered Lake Edge No-Go.`,
      timestamp: iso(minutesAgo(generatedAt, 18)),
    });
  }
  if (lowBattery) {
    alerts.push({
      id: "alert-low-battery-cart-041",
      severity: "warning",
      type: "battery",
      asset_id: lowBattery.asset_id,
      title: "Low battery",
      message: `${lowBattery.name} is at ${lowBattery.battery_percent}% battery.`,
      timestamp: iso(minutesAgo(generatedAt, 6)),
    });
  }
  if (dueMaintenance) {
    alerts.push({
      id: "alert-maintenance-cart-052",
      severity: "info",
      type: "maintenance",
      asset_id: dueMaintenance.asset_id,
      title: "Maintenance due",
      message: `${dueMaintenance.name} is scheduled for brake inspection today.`,
      timestamp: iso(minutesAgo(generatedAt, 42)),
    });
  }
  if (returnPending) {
    alerts.push({
      id: "alert-return-buffer-cart-033",
      severity: "info",
      type: "return",
      asset_id: returnPending.asset_id,
      title: "Return buffer",
      message: `${returnPending.name} is inside Start / Stop and waiting on the return buffer.`,
      timestamp: iso(minutesAgo(generatedAt, 4)),
    });
  }

  return alerts;
}

function buildMaintenanceQueue(rows, generatedAt) {
  return rows
    .filter((row) => row.service_due_in_days <= 8 || row.status === "maintenance")
    .map((row) => ({
      asset_id: row.asset_id,
      name: row.name,
      priority: row.service_due_in_days <= 1 ? "high" : "normal",
      status: row.status === "maintenance" ? "In bay" : "Queued",
      task: row.status === "maintenance" ? "Brake inspection" : "Weekly safety check",
      due: row.service_due_in_days === 0 ? "Today" : `${row.service_due_in_days} days`,
      last_service_at: iso(minutesAgo(generatedAt, 60 * 24 * (30 - Math.min(row.service_due_in_days, 25)))),
      odometer_miles: row.odometer_miles,
    }));
}

function buildReservations(generatedAt) {
  return [
    { id: "tee-101", group: "Garcia foursome", carts_needed: 2, starts_at: iso(minutesFromNow(generatedAt, 24)), status: "Ready" },
    { id: "tee-102", group: "Junior clinic", carts_needed: 3, starts_at: iso(minutesFromNow(generatedAt, 58)), status: "Needs staging" },
    { id: "tee-103", group: "Lodging shuttle", carts_needed: 1, starts_at: iso(minutesFromNow(generatedAt, 86)), status: "Assigned" },
  ];
}

function buildChargingInsights(rows) {
  const low = rows.filter((row) => row.battery_percent <= 30).map((row) => row.name);
  const staleCharge = rows.filter((row) => row.time_since_last_charging_minutes >= 240).map((row) => row.name);
  return {
    low_battery_carts: low,
    stale_charge_carts: staleCharge,
    recommendation: low.length
      ? `${low.join(", ")} should rotate to charging after the current assignment.`
      : "Battery coverage is healthy for the next wave.",
  };
}

function routePoints(anchors, generatedAt, minutesBack) {
  if (!anchors.length) return [];
  if (anchors.length === 1) {
    return [{ ...anchors[0], timestamp: iso(minutesAgo(generatedAt, 2)) }];
  }

  const points = [];
  const samplesPerLeg = 6;
  const totalSamples = (anchors.length - 1) * samplesPerLeg;

  for (let leg = 0; leg < anchors.length - 1; leg += 1) {
    const start = anchors[leg];
    const end = anchors[leg + 1];
    for (let sample = 0; sample < samplesPerLeg; sample += 1) {
      const progress = sample / samplesPerLeg;
      const timelineProgress = points.length / Math.max(1, totalSamples);
      const sampleMinutesAgo = Math.max(2, Math.round(minutesBack - timelineProgress * (minutesBack - 2)));
      points.push({
        latitude: roundCoord(start.latitude + (end.latitude - start.latitude) * progress),
        longitude: roundCoord(start.longitude + (end.longitude - start.longitude) * progress),
        timestamp: iso(minutesAgo(generatedAt, sampleMinutesAgo)),
      });
    }
  }

  points.push({ ...anchors.at(-1), timestamp: iso(minutesAgo(generatedAt, 2)) });
  return points;
}

function latestLocation(pointValue, generatedAt, speedMph = 0) {
  return {
    latitude: pointValue.latitude,
    longitude: pointValue.longitude,
    coordinates: [pointValue.longitude, pointValue.latitude, null],
    updatedAt: iso(minutesAgo(generatedAt, 2)),
    speed: speedMph,
    accuracy: 3,
    raw_status: "demo",
  };
}

function site(id, name, type, center, latRadius, lonRadius, extra = {}) {
  return {
    id,
    name,
    type,
    polygon_points: rectangle(center, latRadius, lonRadius),
    ...extra,
  };
}

function rectangle(center, latRadius, lonRadius) {
  return [
    point(center.latitude - latRadius, center.longitude - lonRadius),
    point(center.latitude - latRadius, center.longitude + lonRadius),
    point(center.latitude + latRadius, center.longitude + lonRadius),
    point(center.latitude + latRadius, center.longitude - lonRadius),
  ];
}

function point(latitude, longitude) {
  return { latitude: roundCoord(latitude), longitude: roundCoord(longitude) };
}

function roundCoord(value) {
  return Number(value.toFixed(6));
}

function minutesAgo(date, minutes) {
  return new Date(date.getTime() - minutes * 60 * 1000);
}

function minutesFromNow(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function iso(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function durationFromMinutes(minutes) {
  if (!Number.isFinite(minutes)) return "-";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${String(remainder).padStart(2, "0")}m`;
}

function estimateMinutes(minutes) {
  return Number.isFinite(minutes) ? `~${durationFromMinutes(minutes)}` : "-";
}

function batteryStatus(percent) {
  if (percent <= 25) return "Critical";
  if (percent <= 40) return "Low";
  if (percent >= 85) return "Charged";
  return "Healthy";
}

function statusLabel(status) {
  if (status === "on_lot") return "On lot";
  if (status === "return_pending") return "Return pending";
  if (status === "out") return "Out";
  if (status === "maintenance") return "Maintenance";
  return "Unknown";
}
