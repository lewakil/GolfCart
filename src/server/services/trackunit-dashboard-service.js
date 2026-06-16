import path from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import {
  TrackunitClient,
  TrackunitError,
  aempIdentifierCandidates,
  getAempFleetSnapshot,
  getAsset,
  getCurrentSites,
  getLocation,
  getSiteDetail,
  inferAssetName,
  listAllAssetIds,
  listSeries,
  listVisibleSites,
  loadEnvFile,
  matchAempEquipment,
  obtainAccessToken,
  queryMetricRange,
  resolveAempLocationHistory,
  extractSiteIds,
} from "../integrations/trackunit-client.js";

const RETURN_BUFFER_MINUTES = 20;
const KM_TO_MILES = 0.621371;
const HOLES_PER_LOOP = 9;
const MINUTES_PER_HOLE = 15;
const HEATMAP_CACHE_URL = new URL("../../.heatmap-cache.json", import.meta.url);
const NO_GO_EVENTS_URL = new URL("../../.no-go-events.json", import.meta.url);
const TRIP_HISTORY_URL = new URL("../../trip-history.json", import.meta.url);

// Loads the project .env file so the server can find Trackunit credentials.
export function loadLocalEnv(projectRoot) {
  loadEnvFile(path.join(projectRoot, ".env"));
}

// Always calculate dashboard times from one UTC "now" per refresh.
function utcNow() {
  return new Date();
}

// Turns Trackunit-ish timestamps into real Date objects, even when the Z is missing.
function parseDate(value) {
  if (typeof value !== "string" || !value) return null;
  const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value);
  const parsed = new Date(hasTimezone ? value : `${value}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Formats dates as compact UTC ISO strings because that is what the APIs expect.
function isoZ(value) {
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Turns the configured lookback into a label humans can read quickly.
function lookbackLabel(hours) {
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

// Optional live-data provider: fetches Trackunit telemetry and normalizes it for the React app.
export class DashboardService {
  // Stores runtime settings from server.js and warms up the optional heatmap cache.
  constructor({
    lookbackHours,
    maxAssets,
    locationHistoryPages,
    aempIdentifierAttempts,
    timeout,
    cacheSeconds,
    fakeCarts = true,
  }) {
    this.lookbackHours = lookbackHours;
    this.maxAssets = maxAssets;
    this.locationHistoryPages = locationHistoryPages;
    this.aempIdentifierAttempts = aempIdentifierAttempts;
    this.timeout = timeout;
    this.cacheSeconds = cacheSeconds;
    this.fakeCarts = fakeCarts;
    this.cache = null;
    this.cacheAt = 0;
    this.trackunitClient = null;
    this.heatmapCache = loadHeatmapCache();
    this.noGoEventLog = loadNoGoEventLog();
    this.tripHistory = loadTripHistory();
  }

  // Lazily creates the Trackunit API client; reused until a token error tells us to refresh it.
  async client() {
    if (!this.trackunitClient) {
      const { accessToken } = await obtainAccessToken(this.timeout);
      this.trackunitClient = new TrackunitClient(accessToken, { timeout: this.timeout });
    }
    return this.trackunitClient;
  }

  // Public entry point used by /api/dashboard. Handles caching, retries, and stale fallback.
  async dashboard({ forceRefresh = false } = {}) {
    const now = Date.now();

    // Tiny cache so one open dashboard does not hammer Trackunit every repaint.
    if (!forceRefresh && this.cache && now - this.cacheAt < this.cacheSeconds * 1000) {
      return this.withFakeCarts(this.cache);
    }

    try {
      const data = await this.fetchDashboard();
      this.cache = data;
      this.cacheAt = now;
      return this.withFakeCarts(data);
    } catch (error) {
      // If a bearer token quietly expired, drop the client and try once with a fresh token.
      if (error instanceof TrackunitError && this.trackunitClient) {
        this.trackunitClient = null;
        try {
          const data = await this.fetchDashboard();
          this.cache = data;
          this.cacheAt = Date.now();
          return this.withFakeCarts(data);
        } catch (retryError) {
          error = retryError;
        }
      }
      if (this.cache) {
        // Better to show slightly old cart info than a dead dashboard at reception.
        return this.withFakeCarts({
          ...this.cache,
          warning: `Showing cached data because Trackunit temporarily refused a refresh: ${error.message}`,
        });
      }
      throw error;
    }
  }

  // Adds or removes the fixed local fake carts after live data is fetched.
  withFakeCarts(data) {
    // Fake carts are just a local demo layer. Flip them off with --no-fake-carts.
    if (!this.fakeCarts) {
      return {
        ...data,
        real_cart_count: data.rows.length,
        fake_cart_enabled: false,
        fake_cart_count: 0,
      };
    }

    const fakeCarts = buildFakeCarts(data);
    return {
      ...data,
      real_cart_count: data.rows.length,
      fake_cart_count: fakeCarts.length,
      fake_cart_enabled: true,
      rows: [...data.rows, ...fakeCarts.map((cart) => cart.row)],
      trip_rows: [...(data.trip_rows || []), ...fakeCarts.map((cart) => cart.tripRow)],
      heatmap_assets: [...data.heatmap_assets, ...fakeCarts.map((cart) => cart.heatmapAsset)],
    };
  }

  // Makes sure the heatmap has something useful even when AEMP history returns empty.
  stabilizeHeatmap(heatmapAssets, generatedAt) {
    // Trackunit history sometimes comes back empty. This keeps the map from going blank.
    const label = lookbackLabel(this.lookbackHours);
    const stableAssets = [];
    let liveHistoryPoints = 0;
    let cachedHistoryPoints = 0;
    let currentPositionPoints = 0;
    let saveCache = false;

    for (const asset of heatmapAssets) {
      const points = cleanPoints(asset.points);

      if (points.length) {
        // Keep only the tail so the local cache stays small and snappy.
        liveHistoryPoints += points.length;
        this.heatmapCache.set(asset.asset_id, {
          points: points.slice(-600),
          cached_at: isoZ(generatedAt),
        });
        stableAssets.push({ ...asset, points, heatmap_source: "history" });
        saveCache = true;
        continue;
      }

      const cached = this.heatmapCache.get(asset.asset_id);
      if (cached?.points?.length) {
        // Not fresh, but still real Trackunit trail data from a previous good pull.
        cachedHistoryPoints += cached.points.length;
        stableAssets.push({
          ...asset,
          points: cached.points,
          heatmap_source: "cached_history",
          heatmap_cached_at: cached.cached_at,
        });
        continue;
      }

      const latest = latestLocationPoint(asset.current_location, generatedAt);
      if (latest) {
        // Last resort: at least show where the real cart is right now.
        currentPositionPoints += 1;
        stableAssets.push({
          ...asset,
          points: [{ ...latest, heatmap_fallback: "current_position" }],
          heatmap_source: "current_position",
        });
        continue;
      }

      stableAssets.push({ ...asset, points: [], heatmap_source: "none" });
    }

    if (saveCache) saveHeatmapCache(this.heatmapCache);

    let mode = "none";
    let note = `No Trackunit positions are available for the past ${label}.`;
    if (liveHistoryPoints) {
      mode = cachedHistoryPoints ? "mixed_history" : "history";
      note = cachedHistoryPoints
        ? `Trackunit trail history from the past ${label}, plus last cached trails where Trackunit returned empty.`
        : `Trackunit trail history from the past ${label}.`;
    } else if (cachedHistoryPoints) {
      const cachedAt = firstCachedAt(stableAssets);
      mode = "cached_history";
      note = `Trackunit returned no new ${label} trail points, so the map uses last cached trails${cachedAt ? ` from ${cachedAt}` : ""}.`;
    } else if (currentPositionPoints) {
      mode = "current_position";
      note = `Trackunit returned no ${label} trail history, so the map shows live cart positions only.`;
    }

    return {
      assets: stableAssets,
      mode,
      note,
      pointCount: liveHistoryPoints + cachedHistoryPoints + currentPositionPoints,
    };
  }

  // Pulls all live inputs from Trackunit and builds the raw dashboard payload.
  async fetchDashboard() {
    const client = await this.client();
    const now = utcNow();
    const label = lookbackLabel(this.lookbackHours);
    const start = new Date(now.getTime() - this.lookbackHours * 60 * 60 * 1000);

    // We keep this broad because the actual account is tiny right now.
    const { assetIds } = await listAllAssetIds(client);
    const selectedAssetIds = assetIds.slice(0, this.maxAssets);

    // Sites are the whole trick: Start/Stop, no-go zones, and hole polygons all live there.
    const sitesCatalog = await listVisibleSites(client, 200);
    const sites = sitesCatalog.sites || [];
    const siteCache = new Map(sites.filter((site) => site.id).map((site) => [site.id, site]));
    const startSite = findStartStopSite(sites);
    const noGoSites = sites.filter(isNoGoSite);
    const apartmentSites = sites.filter(isApartmentSite);
    const holeSites = sites.map(parseHoleSite).filter(Boolean);
    let warning = null;
    let aempSnapshot = null;
    let triedAempSnapshot = false;

    const rows = [];
    const tripRows = [];
    const heatmapAssets = [];
    const noGoEvents = [];
    let tripHistoryChanged = false;

    for (const assetId of selectedAssetIds) {
      const asset = await getAsset(client, assetId);
      const name = inferAssetName(asset, assetId);
      const location = await getLocation(client, assetId);
      const currentSitesRaw = await getCurrentSites(client, assetId);
      const currentSiteIds = extractSiteIds(currentSitesRaw);
      const currentSites = [];

      for (const siteId of currentSiteIds) {
        try {
          currentSites.push(await getSiteDetail(client, siteId, siteCache));
        } catch {
          currentSites.push({ id: siteId, name: siteId });
        }
      }

      let points = await resolveHistoryPoints(client, aempIdentifierCandidates(assetId, asset, null), start, now, {
        pageLimit: this.locationHistoryPages,
        identifierAttempts: this.aempIdentifierAttempts,
      });

      const hasTelematicsSerial = (asset.telematicsDevices || []).some((device) => device?.serialNumber);
      if (!points.length && !hasTelematicsSerial) {
        try {
          if (!triedAempSnapshot) {
            // Usually the telematics serial is enough. This snapshot is only a fallback.
            aempSnapshot = await getAempFleetSnapshot(client);
            triedAempSnapshot = true;
          }
          const equipment = aempSnapshot ? matchAempEquipment(aempSnapshot, assetId, asset) : null;
          points = await resolveHistoryPoints(client, aempIdentifierCandidates(assetId, asset, equipment), start, now, {
            pageLimit: this.locationHistoryPages,
            identifierAttempts: this.aempIdentifierAttempts,
          });
        } catch (error) {
          triedAempSnapshot = true;
          warning = warning || `Heatmap history is limited right now: ${error.message}`;
        }
      }

      const metricNames = await safeSeries(client, assetId, start, now);
      // Distance and battery are time-series metrics; not every cart publishes every metric.
      const batteryMetric = await firstAvailableMetric(
        client,
        assetId,
        ["machine_insight_battery_potential", ...metricNames.filter((metric) => metric.toLowerCase().includes("battery"))],
        start,
        now,
      );
      const distanceMetric = await firstAvailableMetric(
        client,
        assetId,
        ["machine_insight_total_vehicle_distance", "machine_insight_cumulative_operating_distance"],
        start,
        now,
      );
      const charge = summarizeCharge(batteryMetric, now);
      const decisionPoints = mergeHistoryPoints(this.heatmapCache.get(assetId)?.points || [], points);

      // These three summaries become the receptionist-facing row.
      const state = computeCartState({
        name,
        currentSites,
        latestLocation: location,
        historyPoints: decisionPoints,
        startSite,
        generatedAt: now,
      });
      const assetNoGoEvents = summarizeNoGoEvents({
        assetId,
        assetName: name,
        historyPoints: decisionPoints,
        latestLocation: location,
        noGoSites,
        generatedAt: now,
      });
      noGoEvents.push(...assetNoGoEvents);
      const assetObservedNoGoEvents = mergeNoGoEventLog(this.noGoEventLog, assetNoGoEvents);
      const noGo = summarizeNoGoFromEvents(
        eventsForAssetInWindow(assetObservedNoGoEvents, assetId, start, now),
        now,
        label,
      ) || summarizeNoGo({
        historyPoints: decisionPoints,
        latestLocation: location,
        noGoSites,
        generatedAt: now,
      });
      const tripNoGoEvents = eventsForActiveTrip(assetObservedNoGoEvents, assetId, state.tripStartAt, now);
      const tripNoGo = summarizeNoGoFromEvents(tripNoGoEvents, now, "this trip") || {
        entered: false,
        status: state.tripStartAt ? "Clear" : "No active trip",
        detail: state.tripStartAt ? "No no-go hits this trip" : "Cart has no active trip",
      };
      const apartment = summarizeApartment({
        currentSites,
        latestLocation: location,
        apartmentSites,
        generatedAt: now,
      });
      const holeProgress = summarizeHoleProgress({
        historyPoints: decisionPoints,
        latestLocation: location,
        holeSites,
        cartStatus: state.status,
        tripStartAt: state.tripStartAt,
        generatedAt: now,
      });
      const milesDriven = distanceToMiles(distanceMetric);
      const tripMilesDriven = distanceToMilesSince(distanceMetric, state.tripStartAt);

      tripHistoryChanged = updateTripHistoryForAsset(this.tripHistory, {
        assetId,
        assetName: name,
        state,
        holeProgress,
        noGoEvents: tripNoGoEvents,
        milesDriven: tripMilesDriven,
        charge,
        apartment,
        generatedAt: now,
      }) || tripHistoryChanged;

      rows.push({
        asset_id: assetId,
        name,
        status: state.status,
        status_detail: state.statusDetail,
        no_go_entered: noGo.entered,
        no_go_status: noGo.status,
        no_go_detail: noGo.detail,
        apartment_at: apartment.atApartment,
        apartment_status: apartment.status,
        apartment_detail: apartment.detail,
        time_outside: state.timeOutside,
        time_outside_minutes: state.timeOutsideMinutes,
        trip_start_at: state.tripStartAt,
        holes_completed: holeProgress.display,
        holes_completed_count: holeProgress.completedCount,
        holes_completed_detail: holeProgress.detail,
        route_steps: holeProgress.routeSteps,
        route_likely_next: holeProgress.likelyNext,
        route_return_estimate: holeProgress.expectedBack,
        miles_driven: milesDriven,
        time_since_last_charging: charge.timeSinceLastCharging,
        time_since_last_charging_minutes: charge.timeSinceLastChargingMinutes,
        expected_back: holeProgress.expectedBack,
        expected_back_detail: holeProgress.expectedBackDetail,
      });

      tripRows.push({
        asset_id: assetId,
        name,
        status: state.status,
        status_label: statusLabelForData(state.status),
        trip_start_at: state.tripStartAt,
        trip_duration: state.tripStartAt ? formatDurationMinutes(elapsedMinutes(parseDate(state.tripStartAt), now)) : "-",
        holes_completed: holeProgress.display,
        holes_completed_count: holeProgress.completedCount,
        holes_completed_detail: holeProgress.detail,
        route_steps: holeProgress.routeSteps,
        route_likely_next: holeProgress.likelyNext,
        route_return_estimate: holeProgress.expectedBack,
        no_go_entered: tripNoGo.entered,
        no_go_status: tripNoGo.status,
        no_go_detail: tripNoGo.detail,
        no_go_events: compactTripNoGoEvents(tripNoGoEvents),
        miles_driven: tripMilesDriven,
        expected_back: holeProgress.expectedBack,
        calculation_note: state.tripStartAt
          ? `Trip starts when ${name} left Start/Stop; return only closes after ${RETURN_BUFFER_MINUTES} minutes back in Start/Stop.`
          : "No active trip; the previous trip is closed in trip history.",
      });

      heatmapAssets.push({
        asset_id: assetId,
        name,
        points,
        current_location: location,
      });
    }

    rows.sort((left, right) => statusSort(left.status) - statusSort(right.status) || left.name.localeCompare(right.name));
    tripRows.sort((left, right) => statusSort(left.status) - statusSort(right.status) || left.name.localeCompare(right.name));
    const heatmap = this.stabilizeHeatmap(heatmapAssets, now);
    const allNoGoEvents = mergeNoGoEventLog(this.noGoEventLog, noGoEvents);
    if (allNoGoEvents.length !== this.noGoEventLog.length) {
      this.noGoEventLog = allNoGoEvents;
      saveNoGoEventLog(this.noGoEventLog);
    }
    if (tripHistoryChanged) saveTripHistory(this.tripHistory);

    // This is the one JSON shape the browser needs. Keep it boring and predictable.
    return {
      generated_at: isoZ(now),
      lookback_hours: this.lookbackHours,
      lookback_label: label,
      return_buffer_minutes: RETURN_BUFFER_MINUTES,
      sites,
      rows,
      trip_rows: tripRows,
      heatmap_assets: heatmap.assets,
      heatmap_mode: heatmap.mode,
      heatmap_note: heatmap.note,
      heatmap_point_count: heatmap.pointCount,
      no_go_events: allNoGoEvents,
      no_go_recent_events: noGoEvents,
      no_go_summary: summarizeNoGoEventTotals(allNoGoEvents, noGoSites),
      no_go_history_note: `Overall observed by this dashboard. Each backfill run asks Trackunit for the latest ${label}; older totals build up once this app has seen them.`,
      trip_history_summary: summarizeTripHistory(this.tripHistory),
      warning,
    };
  }
}

// Throws away bad GPS points before they can distort map bounds or density.
function cleanPoints(points) {
  // AEMP responses can be inconsistent. Only let real lat/lon pairs into the map.
  return (points || [])
    .filter((point) => Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude)))
    .map((point) => ({
      ...point,
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
    }));
}

// Combines cached and fresh trail points without duplicating the same timestamp/coordinate.
function mergeHistoryPoints(...pointLists) {
  // Cached points help the no-go totals survive when Trackunit returns an empty history page.
  const byKey = new Map();
  for (const point of pointLists.flat()) {
    const timestamp = point.timestamp || point.datetime || point.updatedAt || "";
    const latitude = Number.isFinite(Number(point.latitude)) ? Number(point.latitude).toFixed(6) : "";
    const longitude = Number.isFinite(Number(point.longitude)) ? Number(point.longitude).toFixed(6) : "";
    byKey.set(`${timestamp}|${latitude}|${longitude}`, point);
  }
  return [...byKey.values()];
}

// Reads the last known-good real heatmap points from disk, if the file exists.
function loadHeatmapCache() {
  // This file is optional. If it is missing or weird, we simply start with no cache.
  try {
    const parsed = JSON.parse(readFileSync(HEATMAP_CACHE_URL, "utf8"));
    return new Map(
      Object.entries(parsed.assets || {}).filter(([, value]) => Array.isArray(value.points) && value.points.length),
    );
  } catch {
    return new Map();
  }
}

// Writes the last known-good real heatmap points so a server restart does not blank the map.
function saveHeatmapCache(cache) {
  // Best-effort only. The dashboard should not fail just because the cache file cannot be written.
  const assets = {};
  for (const [assetId, value] of cache.entries()) {
    assets[assetId] = value;
  }
  try {
    writeFileSync(HEATMAP_CACHE_URL, JSON.stringify({ updated_at: isoZ(utcNow()), assets }, null, 2));
  } catch {
    // If the local cache cannot be written, the live dashboard should still work.
  }
}

// Reads the no-go event log that lets totals keep growing beyond the latest API window.
function loadNoGoEventLog() {
  // This starts empty on a fresh install. From then on, refreshes add newly observed crossings.
  try {
    const parsed = JSON.parse(readFileSync(NO_GO_EVENTS_URL, "utf8"));
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch {
    return [];
  }
}

// Writes the no-go event log so "overall observed" totals survive restarts.
function saveNoGoEventLog(events) {
  // Best-effort only. A logging failure should not take down the dashboard.
  try {
    writeFileSync(NO_GO_EVENTS_URL, JSON.stringify({ updated_at: isoZ(utcNow()), events }, null, 2));
  } catch {
    // The live dashboard can still work without persisted no-go totals.
  }
}

// Reads active and completed trips used for charging-pattern learning.
function loadTripHistory() {
  // Active trips survive restarts, then close once the cart is back in Start/Stop.
  try {
    const parsed = JSON.parse(readFileSync(TRIP_HISTORY_URL, "utf8"));
    return normalizeTripHistory(parsed);
  } catch {
    return emptyTripHistory();
  }
}

// Writes the trip history file so charging patterns have memory across refreshes.
function saveTripHistory(history) {
  // Best-effort: the dashboard should keep running even if the local log cannot be written.
  try {
    writeFileSync(TRIP_HISTORY_URL, JSON.stringify({ updated_at: isoZ(utcNow()), ...history }, null, 2));
  } catch {
    // Pattern learning can resume on the next successful write.
  }
}

// Keeps old or hand-edited trip JSON from blowing up the dashboard.
function normalizeTripHistory(parsed) {
  return {
    active_trips: isPlainObject(parsed.active_trips) ? parsed.active_trips : {},
    completed_trips: Array.isArray(parsed.completed_trips) ? parsed.completed_trips : [],
  };
}

// Tiny starter shape for a brand-new dashboard install.
function emptyTripHistory() {
  return { active_trips: {}, completed_trips: [] };
}

// True only for plain JSON objects.
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Updates active/completed trips for one cart from the current dashboard snapshot.
function updateTripHistoryForAsset(history, {
  assetId,
  assetName,
  state,
  holeProgress,
  noGoEvents,
  milesDriven,
  charge,
  apartment,
  generatedAt,
}) {
  // The 20-minute return buffer is the trip close trigger.
  let changed = false;
  const active = history.active_trips[assetId] || null;
  const activeStatus = state.status === "out" || state.status === "return_pending";
  const generatedAtIso = isoZ(generatedAt);

  if (activeStatus) {
    const startedAt = earliestIso(state.tripStartAt, active?.started_at) || generatedAtIso;
    const trip = active || {
      trip_id: tripId(assetId, startedAt),
      asset_id: assetId,
      asset_name: assetName,
      started_at: startedAt,
      first_seen_at: generatedAtIso,
    };
    history.active_trips[assetId] = {
      ...trip,
      trip_id: tripId(assetId, startedAt),
      started_at: startedAt,
      asset_name: assetName,
      last_seen_at: generatedAtIso,
      status: state.status,
      route_steps: holeProgress.routeSteps || [],
      holes_completed_count: holeProgress.completedCount || 0,
      holes_display: holeProgress.display,
      likely_next: holeProgress.likelyNext,
      expected_back: holeProgress.expectedBack,
      miles_driven_window: milesDriven,
      no_go_events: compactTripNoGoEvents(noGoEvents),
      apartment_at: Boolean(apartment.atApartment),
      apartment_status: apartment.status,
      last_charge_signal_at: charge.lastChargingSignalAt,
      last_charge_signal_minutes_ago: charge.timeSinceLastChargingMinutes,
    };
    changed = true;
  }

  if (state.status === "on_lot" && active) {
    const completed = {
      ...active,
      asset_name: assetName,
      ended_at: generatedAtIso,
      return_confirmed_at: generatedAtIso,
      duration_minutes: elapsedMinutes(parseDate(active.started_at), generatedAt),
      close_reason: `${RETURN_BUFFER_MINUTES}-minute Start/Stop buffer satisfied`,
      route_steps: active.route_steps || [],
      holes_completed_count: active.holes_completed_count || 0,
      miles_driven_window: active.miles_driven_window ?? milesDriven,
      no_go_events: active.no_go_events || compactTripNoGoEvents(noGoEvents),
      charge_after_return_at: chargeSignalAfterReturn(charge, generatedAtIso),
    };
    if (!history.completed_trips.some((trip) => trip.trip_id === completed.trip_id)) {
      history.completed_trips.push(completed);
    }
    delete history.active_trips[assetId];
    changed = true;
  }

  changed = updateCompletedTripChargeSignals(history, assetId, charge) || changed;
  return changed;
}

// Builds a stable trip ID from asset and observed trip start time.
function tripId(assetId, startedAt) {
  return `${assetId}:${startedAt || "unknown-start"}`;
}

// Chooses the earliest valid ISO timestamp from a couple of candidates.
function earliestIso(...values) {
  const dates = values
    .map((value) => parseDate(value))
    .filter(Boolean)
    .sort((left, right) => left.getTime() - right.getTime());
  return dates.length ? isoZ(dates[0]) : null;
}

// Keeps just enough no-go detail inside each trip without bloating the file.
function compactTripNoGoEvents(events) {
  return (events || [])
    .filter((event) => event.event_type === "entry")
    .map((event) => ({
      site_name: event.site_name,
      timestamp: event.timestamp,
      latitude: event.latitude,
      longitude: event.longitude,
    }));
}

// Attaches a charge signal if it happened after a trip ended.
function chargeSignalAfterReturn(charge, endedAt) {
  const signalAt = parseDate(charge.lastChargingSignalAt);
  const ended = parseDate(endedAt);
  return signalAt && ended && signalAt >= ended ? charge.lastChargingSignalAt : null;
}

// Backfills charge-after-return when a later refresh sees a newer charging signal.
function updateCompletedTripChargeSignals(history, assetId, charge) {
  // This lets patterns improve after the cart has been back long enough to charge.
  const signalAt = parseDate(charge.lastChargingSignalAt);
  if (!signalAt) return false;
  let changed = false;
  for (const trip of history.completed_trips) {
    if (trip.asset_id !== assetId || trip.charge_after_return_at) continue;
    const ended = parseDate(trip.ended_at);
    if (ended && signalAt >= ended) {
      trip.charge_after_return_at = charge.lastChargingSignalAt;
      changed = true;
    }
  }
  return changed;
}

// Returns lightweight counts for the browser's charging summary.
function summarizeTripHistory(history) {
  return {
    active_count: Object.keys(history.active_trips || {}).length,
    completed_count: (history.completed_trips || []).length,
    trips_with_charge_after_return: (history.completed_trips || []).filter((trip) => trip.charge_after_return_at).length,
  };
}

// Builds a stable key so repeated dashboard refreshes do not double-count no-go crossings.
function noGoEventKey(event) {
  const latitude = Number.isFinite(Number(event.latitude)) ? Number(event.latitude).toFixed(5) : "";
  const longitude = Number.isFinite(Number(event.longitude)) ? Number(event.longitude).toFixed(5) : "";
  return [
    event.asset_id || "",
    event.site_id || event.site_name || "",
    event.event_type || "",
    event.timestamp || "",
    latitude,
    longitude,
  ].join("|");
}

// Adds newly observed no-go crossings to the persisted event log.
function mergeNoGoEventLog(existingEvents, observedEvents) {
  // Trackunit gives recent history repeatedly. This keeps one copy of each crossing.
  const byKey = new Map();
  for (const event of [...(existingEvents || []), ...(observedEvents || [])]) {
    byKey.set(noGoEventKey(event), event);
  }
  return [...byKey.values()].sort((left, right) => {
    const leftDate = parseDate(left.timestamp)?.getTime() || 0;
    const rightDate = parseDate(right.timestamp)?.getTime() || 0;
    return leftDate - rightDate;
  });
}

// Finds the timestamp of the cached trail being shown, for the note on the map.
function firstCachedAt(assets) {
  return assets.find((asset) => asset.heatmap_cached_at)?.heatmap_cached_at || null;
}

// Lists available time-series metrics, but treats failure as "no metrics" instead of fatal.
async function safeSeries(client, assetId, start, end) {
  try {
    return await listSeries(client, assetId, start, end);
  } catch {
    return [];
  }
}

// Asks AEMP for location history using candidate equipment IDs and returns just the points.
async function resolveHistoryPoints(client, identifiers, start, end, { pageLimit, identifierAttempts }) {
  const history = await resolveAempLocationHistory(client, identifiers, start, end, {
    pageLimit,
    identifierAttempts,
    includePoints: true,
  });
  return history.summary?.points || [];
}

// Tries a small list of metric names and returns the first one the cart actually has.
async function firstAvailableMetric(client, assetId, metrics, start, end) {
  const uniqueMetrics = [...new Set(metrics)];
  for (const metric of uniqueMetrics) {
    try {
      const summary = await queryMetricRange(client, assetId, metric, start, end, "15m", {
        chargingHighThreshold: 20,
        chargingUptickThreshold: 5,
      });
      if (summary.available) return summary;
    } catch {
      // Some assets simply do not publish every metric. Keep walking the list.
    }
  }
  return null;
}

// Picks the Start/Stop site from the Trackunit site list.
function findStartStopSite(sites) {
  return (
    sites.find((site) => /start|stop/i.test(site.name || "")) ||
    sites.find((site) => site.type === "DEPOT") ||
    null
  );
}

// A site is a no-go zone if the site name contains "no go".
function isNoGoSite(site) {
  return /no go/i.test(site.name || "");
}

// Lodging-style zones are optional and are detected by common course-housing labels.
function isApartmentSite(site) {
  return /apartment|lejlighed|lejligheder|lodging|cabin|villa|hytte|bolig|feriebolig|sommerhus|guest|room|suite/i.test(site.name || "");
}

// Converts "Forest 4" / "Sky 2" / "Sand 9" sites into course-hole objects.
function parseHoleSite(site) {
  const match = /^(Forest|Sky|Sand)\s+(\d+)$/i.exec(site.name || "");
  if (!match) return null;
  const hole = Number(match[2]);
  if (!Number.isInteger(hole) || hole < 1 || hole > HOLES_PER_LOOP) return null;
  return {
    ...site,
    course: match[1][0].toUpperCase() + match[1].slice(1).toLowerCase(),
    hole,
  };
}

// Creates the three local fixed fake carts used for testing course progress.
function buildFakeCarts(data) {
  // Fixed on purpose: refreshes should not move the test carts around anymore.
  const generatedAt = parseDate(data.generated_at) || utcNow();
  return [
    buildFakeCart(data, generatedAt, { course: "Forest", completedHole: 5, minutesSinceCharge: 140, miles: 6.8 }),
    buildFakeCart(data, generatedAt, { course: "Sky", completedHole: 7, minutesSinceCharge: 215, miles: 9.4 }),
    buildFakeCart(data, generatedAt, { course: "Sand", completedHole: 3, minutesSinceCharge: 95, miles: 4.1, atApartment: true }),
  ];
}

// Builds one fake row plus one fake map asset for a specific course.
function buildFakeCart(data, generatedAt, { course, completedHole, minutesSinceCharge, miles, atApartment = false }) {
  // The fake cart row and fake map asset travel together so table and map tell one story.
  const points = buildFakeRoutePoints(data, course, completedHole, generatedAt);
  const currentPoint = (atApartment ? firstApartmentCenter(data) : null) ||
    points.at(-1) ||
    firstCourseCenter(data, course) ||
    { latitude: 56.4245, longitude: 10.5822 };
  const remaining = Math.max(0, HOLES_PER_LOOP - completedHole);
  const timeOutsideMinutes = completedHole * MINUTES_PER_HOLE + 20;
  const name = `Fake ${course} Cart`;
  const id = `fake-${course.toLowerCase()}-cart`;
  const tripStartAt = isoZ(new Date(generatedAt.getTime() - timeOutsideMinutes * 60 * 1000));

  return {
    row: {
      asset_id: id,
      name,
      is_fake: true,
      status: "out",
      status_detail: "Fake fixed test data; no Trackunit calls",
      no_go_entered: false,
      no_go_status: "Clear",
      no_go_detail: "Fake test cart",
      apartment_at: atApartment,
      apartment_status: atApartment ? "At apartment" : "Clear",
      apartment_detail: atApartment ? "Fake filler apartment zone" : "Fake test cart",
      time_outside: formatDurationMinutes(timeOutsideMinutes),
      time_outside_minutes: timeOutsideMinutes,
      trip_start_at: tripStartAt,
      holes_completed: `${course} ${completedHole}/${HOLES_PER_LOOP}`,
      holes_completed_count: completedHole,
      holes_completed_detail: "Fake fixed route",
      route_steps: Array.from({ length: completedHole }, (_, index) => `${course} ${index + 1}`),
      route_likely_next: completedHole >= HOLES_PER_LOOP ? "Start/Stop" : `${course} ${completedHole + 1}`,
      route_return_estimate: `~${formatDurationMinutes(remaining * MINUTES_PER_HOLE)}`,
      miles_driven: miles,
      time_since_last_charging: formatMinutesEstimate(minutesSinceCharge),
      time_since_last_charging_minutes: minutesSinceCharge,
      expected_back: `~${formatDurationMinutes(remaining * MINUTES_PER_HOLE)}`,
      expected_back_detail: `${MINUTES_PER_HOLE} min/hole fake estimate`,
    },
    tripRow: {
      asset_id: id,
      name,
      is_fake: true,
      status: "out",
      status_label: "Out",
      trip_start_at: tripStartAt,
      trip_duration: formatDurationMinutes(timeOutsideMinutes),
      holes_completed: `${course} ${completedHole}/${HOLES_PER_LOOP}`,
      holes_completed_count: completedHole,
      holes_completed_detail: "Fake fixed route",
      route_steps: Array.from({ length: completedHole }, (_, index) => `${course} ${index + 1}`),
      route_likely_next: completedHole >= HOLES_PER_LOOP ? "Start/Stop" : `${course} ${completedHole + 1}`,
      route_return_estimate: `~${formatDurationMinutes(remaining * MINUTES_PER_HOLE)}`,
      no_go_entered: false,
      no_go_status: "Clear",
      no_go_detail: "Fake test cart has no no-go hits this trip",
      no_go_events: [],
      miles_driven: miles,
      expected_back: `~${formatDurationMinutes(remaining * MINUTES_PER_HOLE)}`,
      calculation_note: "Fake fixed test data; no Trackunit calls.",
    },
    heatmapAsset: {
      asset_id: id,
      name,
      is_fake: true,
      heatmap_source: "fake_position",
      points: [],
      current_location: {
        raw_status: "fake",
        coordinates: [currentPoint.longitude, currentPoint.latitude, null],
        longitude: currentPoint.longitude,
        latitude: currentPoint.latitude,
        updatedAt: isoZ(generatedAt),
        speed: 7,
        accuracy: 1,
        properties: { fake: true },
      },
    },
  };
}

// Makes fake route points so test carts can sit at a believable current position.
function buildFakeRoutePoints(data, course, completedHole, generatedAt) {
  // Use the real hole polygons as anchors, but only the current fake dot is drawn on the map.
  const centers = (data.sites || [])
    .map(parseHoleSite)
    .filter((site) => site?.course === course && site.hole <= completedHole)
    .sort((left, right) => left.hole - right.hole)
    .map(siteCenter)
    .filter(Boolean);

  if (!centers.length) return [];

  const points = [];
  const tripStart = new Date(generatedAt.getTime() - (completedHole * MINUTES_PER_HOLE + 20) * 60 * 1000);
  for (let index = 0; index < centers.length; index += 1) {
    const previous = centers[index - 1] || centers[index];
    const current = centers[index];
    const steps = index === 0 ? 4 : 10;
    for (let step = 0; step < steps; step += 1) {
      const progress = steps === 1 ? 1 : step / (steps - 1);
      points.push({
        latitude: previous.latitude + (current.latitude - previous.latitude) * progress,
        longitude: previous.longitude + (current.longitude - previous.longitude) * progress,
        timestamp: isoZ(new Date(tripStart.getTime() + points.length * 4 * 60 * 1000)),
      });
    }
  }

  return points;
}

// Calculates the rough center of a polygon site.
function siteCenter(site) {
  const points = site.polygon_points || [];
  if (!points.length) return null;
  const total = points.reduce(
    (sum, point) => ({
      latitude: sum.latitude + Number(point.latitude || 0),
      longitude: sum.longitude + Number(point.longitude || 0),
    }),
    { latitude: 0, longitude: 0 },
  );
  return {
    latitude: total.latitude / points.length,
    longitude: total.longitude / points.length,
  };
}

// Finds the first known hole center for a course as a fallback fake-cart location.
function firstCourseCenter(data, course) {
  const site = (data.sites || []).map(parseHoleSite).find((candidate) => candidate?.course === course);
  return site ? siteCenter(site) : null;
}

// Finds the first apartment/lodging zone center for fake apartment tests.
function firstApartmentCenter(data) {
  const site = (data.sites || []).find(isApartmentSite);
  return site ? siteCenter(site) : null;
}

// Checks whether a GPS point is inside a polygon.
function pointInPolygon(point, polygon) {
  // Basic "is this GPS point inside this zone polygon?" math.
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  const x = Number(point.longitude || 0);
  const y = Number(point.latitude || 0);
  let inside = false;
  let previousIndex = polygon.length - 1;

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    const xi = Number(current.longitude || 0);
    const yi = Number(current.latitude || 0);
    const xj = Number(previous.longitude || 0);
    const yj = Number(previous.latitude || 0);
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersects) inside = !inside;
    previousIndex = index;
  }

  return inside;
}

// Gets a timestamp from a history point, regardless of which timestamp key it used.
function pointTimestamp(point) {
  return parseDate(point.timestamp || point.datetime || point.updatedAt);
}

// Turns the latest-location API shape into a normal point object.
function latestLocationPoint(latestLocation, generatedAt) {
  if (!latestLocation) return null;
  const latitude = Number(latestLocation.latitude);
  const longitude = Number(latestLocation.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    timestamp: latestLocation.updatedAt || isoZ(generatedAt),
  };
}

// Combines trail history with latest location so "right now" counts too.
function pointsWithLatest(historyPoints, latestLocation, generatedAt) {
  const points = [...(historyPoints || [])];
  const latest = latestLocationPoint(latestLocation, generatedAt);
  if (latest) points.push(latest);
  return points;
}

// Checks that a point has real numeric coordinates before using it for zone math.
function hasPointCoordinates(point) {
  return Number.isFinite(Number(point?.latitude)) && Number.isFinite(Number(point?.longitude));
}

// Summarizes whether the cart touched any no-go zones in the lookback window.
function summarizeNoGo({ historyPoints, latestLocation, noGoSites, generatedAt }) {
  // Any point inside a site named "no go" counts as a hit for the current lookback.
  const hits = [];
  for (const point of pointsWithLatest(historyPoints, latestLocation, generatedAt)) {
    const timestamp = pointTimestamp(point);
    if (!timestamp || !hasPointCoordinates(point)) continue;
    for (const site of noGoSites) {
      if ((site.polygon_points || []).length >= 3 && pointInPolygon(point, site.polygon_points)) {
        hits.push({ siteName: site.name, timestamp });
      }
    }
  }

  if (!hits.length) {
    return { entered: false, status: "Clear", detail: "No no-go hits" };
  }

  hits.sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  const siteNames = [...new Set(hits.map((hit) => hit.siteName))];
  const lastHit = hits.at(-1);
  return {
    entered: true,
    status: "Entered",
    detail: `${siteNames.slice(0, 2).join(", ")}${siteNames.length > 2 ? ` +${siteNames.length - 2}` : ""} · ${formatDurationMinutes(elapsedMinutes(lastHit.timestamp, generatedAt))} ago`,
  };
}

// Filters persisted no-go events to one cart and the current dashboard lookback.
function eventsForAssetInWindow(events, assetId, start, end) {
  // The persisted log may eventually be older than the visible dashboard window.
  return (events || []).filter((event) => {
    if (event.asset_id !== assetId) return false;
    const timestamp = parseDate(event.timestamp);
    return timestamp && timestamp >= start && timestamp <= end;
  });
}

// Filters no-go events down to the active trip, not the whole lookback window.
function eventsForActiveTrip(events, assetId, tripStartAt, end) {
  const tripStart = parseDate(tripStartAt);
  if (!tripStart) return [];
  return eventsForAssetInWindow(events, assetId, tripStart, end);
}

// Turns persisted no-go entry events into the main table badge.
function summarizeNoGoFromEvents(events, generatedAt, label) {
  // This keeps the row badge aligned with the Operations Summary totals.
  const entries = (events || []).filter((event) => event.event_type === "entry");
  if (!entries.length) return null;

  entries.sort((left, right) => parseDate(left.timestamp).getTime() - parseDate(right.timestamp).getTime());
  const siteNames = [...new Set(entries.map((event) => event.site_name || "No-go zone"))];
  const lastEntry = entries.at(-1);
  const lastEntryAt = parseDate(lastEntry.timestamp);
  return {
    entered: true,
    status: "Entered",
    detail: `${entries.length} entr${entries.length === 1 ? "y" : "ies"} in ${label} · ${siteNames.slice(0, 2).join(", ")}${siteNames.length > 2 ? ` +${siteNames.length - 2}` : ""}${lastEntryAt ? ` · latest ${formatDurationMinutes(elapsedMinutes(lastEntryAt, generatedAt))} ago` : ""}`,
  };
}

// Summarizes whether the cart is currently in an apartment-style zone.
function summarizeApartment({ currentSites, latestLocation, apartmentSites, generatedAt }) {
  // Until apartment sites exist in Trackunit, this tells reception the feature is waiting on setup.
  if (!apartmentSites.length) {
    return { atApartment: false, status: "Not configured", detail: "Waiting for apartment zones" };
  }

  const currentApartmentSite = currentSites.find(isApartmentSite);
  if (currentApartmentSite) {
    return {
      atApartment: true,
      status: "At apartment",
      detail: currentApartmentSite.name || "Apartment zone",
    };
  }

  const latest = latestLocationPoint(latestLocation, generatedAt);
  if (latest && hasPointCoordinates(latest)) {
    const containingSite = apartmentSites.find((site) => (
      (site.polygon_points || []).length >= 3 && pointInPolygon(latest, site.polygon_points)
    ));
    if (containingSite) {
      return {
        atApartment: true,
        status: "At apartment",
        detail: containingSite.name || "Apartment zone",
      };
    }
  }

  return { atApartment: false, status: "Clear", detail: "Not in apartment zone" };
}

// Converts GPS zone crossings into dated no-go entry and exit events.
function summarizeNoGoEvents({ assetId, assetName, historyPoints, latestLocation, noGoSites, generatedAt }) {
  // The API gives sampled positions, so "entry" means first point seen inside that zone.
  const usablePoints = pointsWithLatest(historyPoints, latestLocation, generatedAt)
    .map((point) => ({ point, timestamp: pointTimestamp(point) }))
    .filter(({ point, timestamp }) => timestamp && hasPointCoordinates(point))
    .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());

  const events = [];
  for (const site of noGoSites) {
    const polygon = site.polygon_points || [];
    if (polygon.length < 3) continue;

    let wasInside = false;
    for (const { point, timestamp } of usablePoints) {
      const inside = pointInPolygon(point, polygon);
      if (inside && !wasInside) {
        events.push(noGoEvent(assetId, assetName, site, "entry", timestamp, point));
      }
      if (!inside && wasInside) {
        events.push(noGoEvent(assetId, assetName, site, "exit", timestamp, point));
      }
      wasInside = inside;
    }
  }

  return events.sort((left, right) => parseDate(left.timestamp).getTime() - parseDate(right.timestamp).getTime());
}

// Builds one no-go event in the shape the browser tables expect.
function noGoEvent(assetId, assetName, site, eventType, timestamp, point) {
  return {
    asset_id: assetId,
    asset_name: assetName,
    site_id: site.id || null,
    site_name: site.name || "No-go zone",
    event_type: eventType,
    timestamp: isoZ(timestamp),
    latitude: Number(point.latitude),
    longitude: Number(point.longitude),
  };
}

// Groups all no-go entry/exit events into a per-zone tally table.
function summarizeNoGoEventTotals(events, noGoSites = []) {
  const groups = new Map();

  for (const site of noGoSites) {
    const key = site.name || site.id || "No-go zone";
    groups.set(key, {
      site_name: key,
      entry_count: 0,
      exit_count: 0,
      carts: new Set(),
      last_event_at: null,
      last_event_type: null,
    });
  }

  for (const event of events) {
    const key = event.site_name || "No-go zone";
    const existing = groups.get(key) || {
      site_name: key,
      entry_count: 0,
      exit_count: 0,
      carts: new Set(),
      last_event_at: null,
      last_event_type: null,
    };

    if (event.event_type === "entry") existing.entry_count += 1;
    if (event.event_type === "exit") existing.exit_count += 1;
    if (event.asset_name) existing.carts.add(event.asset_name);

    const eventDate = parseDate(event.timestamp);
    const lastDate = parseDate(existing.last_event_at);
    if (eventDate && (!lastDate || eventDate > lastDate)) {
      existing.last_event_at = event.timestamp;
      existing.last_event_type = event.event_type;
    }

    groups.set(key, existing);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      carts: [...group.carts].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => (
      right.entry_count - left.entry_count ||
      String(right.last_event_at || "").localeCompare(String(left.last_event_at || "")) ||
      left.site_name.localeCompare(right.site_name)
    ));
}

// Figures out current course progress from hole-zone visits after the trip started.
function summarizeHoleProgress({ historyPoints, latestLocation, holeSites, cartStatus, tripStartAt, generatedAt }) {
  // Hole progress is GPS-zone based. No hole-zone hits means we cannot guess the route.
  if (cartStatus === "on_lot") {
    return {
      display: "-",
      detail: "Cart is back",
      completedCount: 0,
      routeSteps: [],
      likelyNext: "Cart is back",
      expectedBack: "-",
      expectedBackDetail: "Cart is back",
    };
  }

  const tripStart = parseDate(tripStartAt);
  const visits = [];
  for (const point of pointsWithLatest(historyPoints, latestLocation, generatedAt)) {
    const timestamp = pointTimestamp(point);
    if (!timestamp || !hasPointCoordinates(point)) continue;
    if (tripStart && timestamp < tripStart) continue;
    for (const site of holeSites) {
      if ((site.polygon_points || []).length >= 3 && pointInPolygon(point, site.polygon_points)) {
        visits.push({ course: site.course, hole: site.hole, timestamp });
      }
    }
  }

  if (!visits.length) {
    return {
      display: "-",
      detail: "Waiting for hole zones",
      completedCount: 0,
      routeSteps: [],
      likelyNext: "Needs first hole",
      expectedBack: "-",
      expectedBackDetail: "Needs first hole",
    };
  }

  visits.sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
  const routeSegments = buildCourseSegments(visits);
  const activeSegment = routeSegments.at(-1);
  const latestHole = activeSegment.holes.at(-1);
  const completedCount = routeSegments.reduce((total, segment) => total + segment.holes.length, 0);
  const remainingInActiveCourse = Math.max(0, HOLES_PER_LOOP - latestHole);
  const routeSteps = routeSegments.flatMap((segment) => segment.holes.map((hole) => `${segment.course} ${hole}`));
  const likelyNext = latestHole >= HOLES_PER_LOOP ? "Start/Stop or next course" : `${activeSegment.course} ${latestHole + 1}`;
  const courseSummary = summarizeCourseSegments(routeSegments);
  const courseCount = new Set(routeSegments.map((segment) => segment.course)).size;

  return {
    display: courseSummary,
    detail: `${completedCount} hole${completedCount === 1 ? "" : "s"} inferred from chronological course flow across ${courseCount} course${courseCount === 1 ? "" : "s"}`,
    completedCount,
    routeSteps,
    likelyNext,
    expectedBack: remainingInActiveCourse === 0 ? "Soon" : `~${formatDurationMinutes(remainingInActiveCourse * MINUTES_PER_HOLE)}`,
    expectedBackDetail: `${MINUTES_PER_HOLE} min/hole estimate`,
  };
}

// Turns sparse hole hits into chronological course segments.
function buildCourseSegments(visits) {
  // If we see Sand 1 then Sand 4, assume Sand 2 and 3 happened between samples.
  const segments = [];
  for (const visit of visits) {
    let segment = segments.at(-1);
    const lastHole = segment?.holes.at(-1);

    if (!segment || segment.course !== visit.course || (visit.hole < lastHole && lastHole >= HOLES_PER_LOOP)) {
      segment = { course: visit.course, holes: [] };
      segments.push(segment);
    }

    const currentLastHole = segment.holes.at(-1);
    if (currentLastHole === visit.hole) continue;
    if (currentLastHole && visit.hole < currentLastHole) continue;

    const startHole = currentLastHole ? currentLastHole + 1 : 1;
    for (let hole = startHole; hole <= visit.hole; hole += 1) {
      segment.holes.push(hole);
    }
  }
  return segments.filter((segment) => segment.holes.length);
}

// Creates a compact route summary like "Sky 9 + Forest 1".
function summarizeCourseSegments(routeSegments) {
  return routeSegments.map((segment) => `${segment.course} ${segment.holes.at(-1)}`).join(" + ");
}

// Decides if the cart is On lot, Return pending, Out, or Unknown.
function computeCartState({ name, currentSites, latestLocation, historyPoints, startSite, generatedAt }) {
  // Status is mostly "inside Start/Stop or not", with the 20-minute buffer layered on top.
  const currentSiteNames = currentSites.map((site) => String(site.name || ""));
  const inStartBySite = currentSiteNames.some((siteName) => /start|stop/i.test(siteName));
  const polygon = startSite?.polygon_points || [];

  const latestPoint = {
    latitude: latestLocation.latitude,
    longitude: latestLocation.longitude,
    timestamp: latestLocation.updatedAt || isoZ(generatedAt),
  };

  let inStartNow = inStartBySite;
  if (polygon.length && latestPoint.latitude !== null && latestPoint.longitude !== null) {
    inStartNow = pointInPolygon(latestPoint, polygon);
  }

  const events = [];
  for (const point of historyPoints || []) {
    const timestamp = pointTimestamp(point);
    if (!timestamp || point.latitude === null || point.longitude === null) continue;
    events.push([timestamp, polygon.length ? pointInPolygon(point, polygon) : false]);
  }

  if (latestPoint.latitude !== null && latestPoint.longitude !== null) {
    events.push([parseDate(String(latestPoint.timestamp)) || generatedAt, inStartNow]);
  }

  events.sort((left, right) => left[0].getTime() - right[0].getTime());

  let state = "unknown";
  let tripStart = null;
  let insideStreakStart = null;
  let confirmedInsideAt = null;
  const bufferMs = RETURN_BUFFER_MINUTES * 60 * 1000;

  // Bathroom-break guard: the cart has to stay in Start/Stop before it is "back".
  for (const [timestamp, inside] of events) {
    if (inside) {
      if (!insideStreakStart) insideStreakStart = timestamp;
      if (timestamp.getTime() - insideStreakStart.getTime() >= bufferMs) {
        state = "on_lot";
        confirmedInsideAt = new Date(insideStreakStart.getTime() + bufferMs);
        tripStart = null;
      }
    } else {
      if (state !== "out") tripStart = timestamp;
      state = "out";
      insideStreakStart = null;
    }
  }

  if (inStartNow) {
    if (!insideStreakStart) insideStreakStart = generatedAt;
    const insideDurationMs = generatedAt.getTime() - insideStreakStart.getTime();
    if (insideDurationMs >= bufferMs) {
      return {
        name,
        status: "on_lot",
        statusDetail: "Confirmed in Start/Stop",
        timeOutside: formatDurationMinutes(0),
        timeOutsideMinutes: 0,
        tripStartAt: null,
      };
    }
    const minutesOutside = elapsedMinutes(tripStart, generatedAt);
    const stopped = Number(latestLocation.speed || 0) === 0;
    return {
      name,
      status: "return_pending",
      statusDetail: `${stopped ? "Parked" : "Inside"} in Start/Stop, confirming ${RETURN_BUFFER_MINUTES}-min buffer (${formatMinutes(insideDurationMs / 60000)})`,
      timeOutside: minutesOutside === null ? "-" : formatDurationMinutes(minutesOutside),
      timeOutsideMinutes: minutesOutside,
      tripStartAt: tripStart ? isoZ(tripStart) : null,
    };
  }

  if (state === "out") {
    const minutesOutside = elapsedMinutes(tripStart, generatedAt);
    return {
      name,
      status: "out",
      statusDetail: "Outside Start/Stop",
      timeOutside: minutesOutside === null ? "-" : formatDurationMinutes(minutesOutside),
      timeOutsideMinutes: minutesOutside,
      tripStartAt: tripStart ? isoZ(tripStart) : null,
    };
  }

  if (confirmedInsideAt) {
    return {
      name,
      status: "on_lot",
      statusDetail: "Confirmed in Start/Stop",
      timeOutside: formatDurationMinutes(0),
      timeOutsideMinutes: 0,
      tripStartAt: null,
    };
  }

  return {
    name,
    status: "unknown",
    statusDetail: "Waiting for enough zone history",
    timeOutside: "-",
    timeOutsideMinutes: null,
    tripStartAt: null,
  };
}

// Returns whole minutes between two Date objects.
function elapsedMinutes(start, end) {
  if (!start) return null;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

// Formats minutes as "12m" or "2h 05m" for the table.
function formatDurationMinutes(minutes) {
  if (minutes === null || minutes === undefined) return "-";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${String(remainder).padStart(2, "0")}m`;
}

// Rounds a decimal minute count before formatting it.
function formatMinutes(minutes) {
  return formatDurationMinutes(Math.max(0, Math.round(minutes)));
}

// Adds the "~" prefix for estimate-style table values.
function formatMinutesEstimate(minutes) {
  return minutes === null || minutes === undefined ? "-" : `~${formatDurationMinutes(minutes)}`;
}

// Estimates last charging signal from a big upward battery-potential jump.
function summarizeCharge(metric, now) {
  if (!metric) {
    return {
      state: "unknown",
      timeSinceLastCharging: "-",
      timeSinceLastChargingMinutes: null,
      lastChargingSignalAt: null,
    };
  }

  // Battery potential is voltage, not a real charger-state flag.
  // A big upward jump is our best "probably charged" signal for now.
  const jumps = metric.charging_upticks || [];
  const lastJump = jumps.length ? parseDate(jumps.at(-1).at) : null;
  const minutes = elapsedMinutes(lastJump, now);
  return {
    state: lastJump ? "charging_signal_seen" : "unknown",
    timeSinceLastCharging: formatMinutesEstimate(minutes),
    timeSinceLastChargingMinutes: minutes,
    lastChargingSignalAt: lastJump ? isoZ(lastJump) : null,
  };
}

// Converts the distance metric's kilometer delta into miles.
function distanceToMiles(metric) {
  if (!metric) return null;
  // Trackunit gives us kilometers here. Reception wanted miles.
  return Math.round(Number(metric.net_change || 0) * KM_TO_MILES * 10) / 10;
}

// Converts the cumulative distance metric into miles since this trip started.
function distanceToMilesSince(metric, tripStartAt) {
  // The cumulative counter does not reset per rental, so we subtract the trip-start sample.
  const tripStart = parseDate(tripStartAt);
  if (!metric || !tripStart || !Array.isArray(metric.samples) || !metric.samples.length) return null;

  const samples = metric.samples
    .map((sample) => ({ at: parseDate(sample.at), value: Number(sample.value) }))
    .filter((sample) => sample.at && Number.isFinite(sample.value))
    .sort((left, right) => left.at.getTime() - right.at.getTime());
  if (samples.length < 2) return null;

  const last = samples.at(-1);
  const sampleBeforeStart = [...samples].reverse().find((sample) => sample.at <= tripStart);
  const sampleAfterStart = samples.find((sample) => sample.at >= tripStart);
  const baseline = sampleBeforeStart || sampleAfterStart;
  if (!baseline || last.at < tripStart) return null;

  const kilometers = Math.max(0, last.value - baseline.value);
  return Math.round(kilometers * KM_TO_MILES * 10) / 10;
}

// Browser-friendly status text for secondary tables.
function statusLabelForData(status) {
  if (status === "on_lot") return "On lot";
  if (status === "return_pending") return "Return pending";
  if (status === "out") return "Out";
  return "Unknown";
}

// Sorts table rows so available carts appear before pending/out/unknown.
function statusSort(status) {
  return { on_lot: 0, return_pending: 1, out: 2, unknown: 3 }[status] ?? 4;
}
