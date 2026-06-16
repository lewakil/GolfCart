import { readFileSync } from "node:fs";

const API_BASE = "https://iris.trackunit.com/api";
const AEMP_BASE = "https://iris.trackunit.com/public/api/aemp/v2";
const AUTH_V2_URL = "https://auth.trackunit.com/token/v2";
const AUTH_LEGACY_URL = "https://auth.trackunit.com/token";

// Custom error type so the dashboard can recognize Trackunit/API failures.
export class TrackunitError extends Error {}

// Reads KEY=value lines from .env into process.env.
export function loadEnvFile(filePath) {
  // Tiny .env reader so this can run without adding dotenv as a dependency.
  let text = "";
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [rawKey, ...rawValue] = line.split("=");
    const key = rawKey.trim();
    const value = rawValue.join("=").trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

// Small wrapper around fetch for authenticated Trackunit calls.
export class TrackunitClient {
  constructor(accessToken, { timeout = 30 } = {}) {
    this.accessToken = accessToken;
    this.timeout = timeout;
  }

  async request(method, pathOrUrl, { query = null, body = null, accept = "application/json" } = {}) {
    // One wrapper for all Trackunit calls: auth header, timeout, JSON cleanup, useful errors.
    const url = new URL(pathOrUrl.startsWith("http") ? pathOrUrl : `${API_BASE}${pathOrUrl}`);
    if (query) appendQuery(url, query);

    const headers = {
      Authorization: `Bearer ${this.accessToken}`,
      Accept: accept,
      "User-Agent": "golf-cart-tracker-node/1.0",
    };

    const options = { method: method.toUpperCase(), headers };
    if (body) {
      options.body = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }

    const response = await fetchWithTimeout(url, options, this.timeout);
    const text = await response.text();
    if (!response.ok) {
      throw new TrackunitError(`HTTP ${response.status} from ${stripQuery(url.href)}: ${compactError(text)}`);
    }

    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: parseBody(text),
      text,
    };
  }
}

// Gets a bearer token from whichever auth style is configured in .env.
export async function obtainAccessToken(timeout) {
  // Prefer an already-made bearer token, then modern client credentials, then legacy login.
  if (process.env.TRACKUNIT_ACCESS_TOKEN) {
    return { accessToken: process.env.TRACKUNIT_ACCESS_TOKEN, authMode: "TRACKUNIT_ACCESS_TOKEN" };
  }

  const clientId = process.env.TRACKUNIT_CLIENT_ID;
  const clientSecret = process.env.TRACKUNIT_CLIENT_SECRET;
  const scopes = process.env.TRACKUNIT_SCOPES;
  if (clientId && clientSecret && scopes) {
    const body = {
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: scopes,
    };
    const token = await tokenRequest(AUTH_V2_URL, body, {}, timeout);
    return { accessToken: token.access_token, authMode: "client_credentials_v2" };
  }

  const username = process.env.TRACKUNIT_USERNAME;
  const password = process.env.TRACKUNIT_PASSWORD;
  const legacyClientId = process.env.TRACKUNIT_LEGACY_CLIENT_ID || clientId;
  const legacyClientSecret = process.env.TRACKUNIT_LEGACY_CLIENT_SECRET || clientSecret;
  if (username && password && legacyClientId && legacyClientSecret) {
    const basic = Buffer.from(`${legacyClientId}:${legacyClientSecret}`).toString("base64");
    const body = {
      grant_type: "password",
      username,
      password,
      scope: process.env.TRACKUNIT_LEGACY_SCOPES || "api",
    };
    const token = await tokenRequest(AUTH_LEGACY_URL, body, { Authorization: `Basic ${basic}` }, timeout);
    return { accessToken: token.access_token, authMode: "legacy_password_flow" };
  }

  throw new TrackunitError(
    "Missing credentials. Add TRACKUNIT_ACCESS_TOKEN, client credentials, or legacy username/password credentials to .env.",
  );
}

// Calls the Trackunit auth endpoint and validates that a token came back.
async function tokenRequest(url, body, extraHeaders, timeout) {
  const response = await fetchWithTimeout(
    new URL(url),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "golf-cart-tracker-node/1.0",
        ...extraHeaders,
      },
      body: new URLSearchParams(body).toString(),
    },
    timeout,
  );
  const text = await response.text();
  if (!response.ok) {
    throw new TrackunitError(`Token request failed with HTTP ${response.status}: ${compactError(text)}`);
  }
  const parsed = parseBody(text);
  if (!parsed?.access_token) throw new TrackunitError("Token response did not contain access_token");
  return parsed;
}

// Runs fetch with an AbortController so stuck API calls do not hang the dashboard.
async function fetchWithTimeout(url, options, timeoutSeconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    throw new TrackunitError(`Network error calling ${stripQuery(url.href)}: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// Adds query parameters to a URL, including repeated array params.
function appendQuery(url, query) {
  const entries = Array.isArray(query) ? query : Object.entries(query);
  for (const [key, value] of entries) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.append(key, String(value));
    }
  }
}

// Removes the query string from URLs before putting them in error messages.
function stripQuery(url) {
  return url.split("?", 1)[0];
}

// Shrinks API error bodies into something readable for logs and dashboard warnings.
function compactError(text) {
  if (!text) return "empty response";
  try {
    return JSON.stringify(JSON.parse(text)).slice(0, 500);
  } catch {
    return text.split(/\s+/).join(" ").slice(0, 500);
  }
}

// Parses JSON, newline JSON, or plain text responses.
function parseBody(text) {
  // Most endpoints are JSON. AEMP can also return newline JSON, so handle that too.
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    const parsedLines = [];
    for (const line of lines) {
      try {
        parsedLines.push(JSON.parse(line));
      } catch {
        return trimmed;
      }
    }
    return parsedLines;
  }
}

// Finds the array inside the common wrapper keys used by Trackunit endpoints.
function flattenItems(value) {
  // Different APIs wrap arrays under different keys. This keeps callers from caring.
  if (Array.isArray(value)) return value;
  if (isObject(value)) {
    for (const key of ["content", "items", "payload", "data", "groups", "assets", "assetIds", "Equipment", "equipment"]) {
      if (Array.isArray(value[key])) return value[key];
    }
    if (Array.isArray(value.edges)) return value.edges.map((edge) => (isObject(edge) ? edge.node || edge : edge));
  }
  return [];
}

// Recursively collects every object inside a nested response.
function deepIterDicts(value) {
  const found = [];
  if (isObject(value)) {
    found.push(value);
    for (const item of Object.values(value)) found.push(...deepIterDicts(item));
  } else if (Array.isArray(value)) {
    for (const item of value) found.push(...deepIterDicts(item));
  }
  return found;
}

// Recursively finds the first value with one of the requested keys.
function findFirstKey(value, keys) {
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (keys.has(key)) return item;
    }
    for (const item of Object.values(value)) {
      const found = findFirstKey(item, keys);
      if (found !== null && found !== undefined) return found;
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstKey(item, keys);
      if (found !== null && found !== undefined) return found;
    }
  }
  return null;
}

// Case-insensitive object lookup for API fields like Latitude vs latitude.
function getCi(mapping, ...names) {
  if (!isObject(mapping)) return null;
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, value] of Object.entries(mapping)) {
    if (wanted.has(key.toLowerCase())) return value;
  }
  return null;
}

// Converts strings/numbers/nested value objects into a finite number when possible.
function toFloat(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (isObject(value)) {
    for (const key of ["value", "Value", "latitude", "Latitude", "longitude", "Longitude", "Length", "BatteryPotential"]) {
      const parsed = toFloat(value[key]);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

// Converts ISO or epoch-ish timestamps into seconds since epoch.
function parseTimestamp(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value) return null;
  const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value);
  const parsed = Date.parse(hasTimezone ? value : `${value}Z`);
  return Number.isNaN(parsed) ? null : parsed / 1000;
}

// True only for plain object-ish values, not arrays or null.
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Discovers asset IDs visible to this Trackunit account.
export async function listAllAssetIds(client, { includeHidden = false } = {}) {
  // Try the real asset list first, then latest locations as a fallback discovery source.
  const attempts = [
    ["/asset/v2/assets", { includeHidden: String(includeHidden) }, "Asset API v2"],
    ["/location/v1/locations", null, "Location API latest locations"],
  ];
  const errors = [];

  for (const [path, query, source] of attempts) {
    try {
      const result = await client.request("GET", path, { query });
      const assetIds = normalizeAssetIds(result.body);
      if (assetIds.length) return { assetIds, source };
      errors.push(`${source}: response did not contain asset IDs`);
    } catch (error) {
      errors.push(`${source}: ${error.message}`);
    }
  }

  throw new TrackunitError(`Could not discover visible assets. ${errors.join(" | ")}`);
}

// Extracts unique asset IDs from whichever response wrapper was returned.
function normalizeAssetIds(value) {
  const ids = [];
  for (const item of flattenItems(value)) {
    if (typeof item === "string") {
      ids.push(item);
    } else if (isObject(item)) {
      const candidate = item.assetId || item.asset_id || item.id || item.uuid || findFirstKey(item, new Set(["assetId", "asset_id"]));
      if (candidate) ids.push(String(candidate));
    }
  }
  return [...new Set(ids)];
}

// Fetches one asset record, mainly for name and telematics-device identifiers.
export async function getAsset(client, assetId) {
  const result = await client.request("GET", `/asset/v1/assets/${assetId}`);
  return isObject(result.body) ? result.body : { raw: result.body };
}

// Fetches the cart's latest GPS point.
export async function getLocation(client, assetId) {
  // Normalize GeoJSON-ish latest-location data into the shape the dashboard expects.
  const result = await client.request("GET", `/location/v1/locations/${assetId}`);
  const body = isObject(result.body) ? result.body : { raw: result.body };
  const geometry = isObject(body.geometry) ? body.geometry : {};
  const properties = isObject(body.properties) ? body.properties : {};
  const coordinates = geometry.coordinates;
  return {
    raw_status: "ok",
    coordinates,
    longitude: Array.isArray(coordinates) && coordinates.length >= 2 ? coordinates[0] : null,
    latitude: Array.isArray(coordinates) && coordinates.length >= 2 ? coordinates[1] : null,
    updatedAt: properties.updatedAt || body.updatedAt || null,
    speed: properties.speed,
    accuracy: properties.accuracy,
    properties,
  };
}

// Fetches which Trackunit sites/zones the asset is currently inside.
export async function getCurrentSites(client, assetId) {
  const result = await client.request("POST", "/site/v1/assets/sites", { body: { assetIds: [assetId] } });
  return isObject(result.body) ? result.body : { raw: result.body };
}

// Extracts site IDs from the current-sites response.
export function extractSiteIds(value) {
  const siteIds = [];
  for (const item of deepIterDicts(value)) {
    const siteId = item.siteId || item.id;
    if (siteId) siteIds.push(String(siteId));
  }
  return [...new Set(siteIds)];
}

// Normalizes a Trackunit site into name/type/polygon fields the dashboard can use.
function summarizeSite(site) {
  // Sites are messy but important: this pulls out the name/type and polygon points.
  const siteId = String(site.id || site.siteId || "");
  const area = isObject(site.area) ? site.area : {};
  const location = isObject(site.location) ? site.location : {};
  const polygon = area.polygon || site.polygon || location.polygon || findFirstKey(site, new Set(["polygon"]));
  let pointCount = 0;
  let polygonPoints = [];

  if (Array.isArray(polygon)) {
    pointCount = countCoordinatePairs(polygon) || polygon.length;
    polygonPoints = extractCoordinatePairs(polygon);
  } else if (isObject(polygon)) {
    const coordinates = polygon.coordinates;
    if (Array.isArray(coordinates)) {
      pointCount = countCoordinatePairs(coordinates) || (Array.isArray(coordinates[0]) ? coordinates[0].length : coordinates.length);
      polygonPoints = extractCoordinatePairs(coordinates);
    } else {
      pointCount = countCoordinatePairs(polygon);
      polygonPoints = extractCoordinatePairs(polygon);
    }
  }

  return {
    id: siteId || null,
    name: site.name || site.displayName || null,
    type: site.type || site.siteType || null,
    status: site.status || null,
    address: site.address || location.address || null,
    has_polygon: Boolean(polygon),
    polygon_point_count: pointCount,
    polygon_points: polygonPoints,
    raw_keys: Object.keys(site).sort(),
  };
}

// Gets full site details, using the list-visible-sites cache when possible.
export async function getSiteDetail(client, siteId, siteCache) {
  if (!siteCache.has(siteId)) {
    const result = await client.request("GET", `/site/v1/sites/${siteId}`);
    const body = isObject(result.body) ? result.body : { raw: result.body };
    siteCache.set(siteId, summarizeSite(body));
  }
  return siteCache.get(siteId);
}

// Lists visible Trackunit sites, including Start/Stop, no-go zones, and holes.
export async function listVisibleSites(client, limit) {
  const result = await client.request("GET", "/site/v1/sites", { query: { size: limit } });
  const sites = flattenItems(result.body).filter(isObject).map(summarizeSite);
  return {
    available: true,
    count: sites.length,
    total_elements: isObject(result.body) ? result.body.totalElements : null,
    sites: sites.slice(0, limit),
  };
}

// Lists metric names available for an asset in the selected time window.
export async function listSeries(client, assetId, start, end) {
  const query = [
    ["match[]", '{__name__=~".+"}'],
    ["start", isoZ(start)],
    ["end", isoZ(end)],
  ];
  const result = await client.request("GET", `/time-series/v1/assets/${assetId}/prometheus/api/v1/series`, { query });
  const body = result.body;
  if (isObject(body)) {
    const data = body.data;
    if (Array.isArray(data)) {
      return [...new Set(data.filter(isObject).map((item) => item.__name__).filter(Boolean).map(String))].sort();
    }
    if (isObject(data)) {
      return [...new Set(flattenItems(data).filter(isObject).map((item) => item.__name__).filter(Boolean).map(String))].sort();
    }
  }
  return [];
}

// Queries one Prometheus-style metric over time and summarizes the samples.
export async function queryMetricRange(client, assetId, metric, start, end, step, { chargingHighThreshold, chargingUptickThreshold }) {
  // Prometheus-ish time series: distance, battery potential, and maybe charger-ish signals.
  const result = await client.request("GET", `/time-series/v1/assets/${assetId}/prometheus/api/v1/query_range`, {
    query: {
      query: `last_over_time(${metric}[30m])`,
      start: isoZ(start),
      end: isoZ(end),
      step,
    },
  });
  const samples = extractPrometheusSamples(result.body);
  const summary = summarizeSamples(metric, samples);
  if (summary.available) {
    summary.daily_deltas = summarizeDailyDeltas(samples);
    if (metric.toLowerCase().includes("battery") || metric.toLowerCase().includes("charger")) {
      summary.charging_windows = detectChargingWindows(samples, chargingHighThreshold);
      summary.charging_upticks = detectPositiveJumps(samples, chargingUptickThreshold);
    }
  }
  return summary;
}

// Pulls [timestamp, value] samples out of a Prometheus query_range response.
function extractPrometheusSamples(body) {
  const results = body?.data?.result;
  if (!Array.isArray(results)) return [];
  const samples = [];
  for (const series of results) {
    if (!isObject(series) || !Array.isArray(series.values)) continue;
    for (const point of series.values) {
      if (!Array.isArray(point) || point.length < 2) continue;
      const timestamp = Number(point[0]);
      const value = Number(point[1]);
      if (Number.isFinite(timestamp) && Number.isFinite(value)) samples.push([timestamp, value]);
    }
  }
  return samples;
}

// Summarizes first/last/min/max/net-change for a metric.
function summarizeSamples(metric, samples) {
  if (!samples.length) return { metric, available: false, sample_count: 0 };
  const sorted = [...samples].sort((left, right) => left[0] - right[0]);
  const values = sorted.map((sample) => sample[1]);
  const positiveJumps = [];
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index][1] > sorted[index - 1][1]) {
      positiveJumps.push([sorted[index][0], sorted[index][1] - sorted[index - 1][1]]);
    }
  }
  const largestUptick = Math.max(0, ...positiveJumps.map((jump) => jump[1]));
  const largestUptickAt = positiveJumps.find((jump) => jump[1] === largestUptick)?.[0] || null;
  return {
    metric,
    available: true,
    sample_count: sorted.length,
    samples: sorted.map(([timestamp, value]) => ({
      at: new Date(timestamp * 1000).toISOString(),
      value,
    })),
    first_at: new Date(sorted[0][0] * 1000).toISOString(),
    last_at: new Date(sorted.at(-1)[0] * 1000).toISOString(),
    first_value: values[0],
    last_value: values.at(-1),
    min_value: Math.min(...values),
    max_value: Math.max(...values),
    net_change: values.at(-1) - values[0],
    largest_positive_step: largestUptick,
    largest_positive_step_at: largestUptickAt ? new Date(largestUptickAt * 1000).toISOString() : null,
  };
}

// Splits metric samples by day so daily deltas are available if needed later.
function summarizeDailyDeltas(samples) {
  const byDay = new Map();
  for (const [timestamp, value] of [...samples].sort((left, right) => left[0] - right[0])) {
    const day = new Date(timestamp * 1000).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push([timestamp, value]);
  }
  return [...byDay.entries()].map(([date, daySamples]) => {
    const first = daySamples[0];
    const last = daySamples.at(-1);
    return {
      date,
      first_value: first[1],
      last_value: last[1],
      delta: last[1] - first[1],
      sample_count: daySamples.length,
    };
  });
}

// Finds large upward jumps, used as the best current charging signal.
function detectPositiveJumps(samples, threshold) {
  const jumps = [];
  const sorted = [...samples].sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const delta = current[1] - previous[1];
    if (delta >= threshold) {
      jumps.push({
        at: new Date(current[0] * 1000).toISOString(),
        previous_at: new Date(previous[0] * 1000).toISOString(),
        previous_value: previous[1],
        value: current[1],
        delta,
      });
    }
  }
  return jumps.slice(0, 20);
}

// Groups samples above a threshold into rough charging windows.
function detectChargingWindows(samples, highThreshold) {
  const windows = [];
  let current = [];
  for (const [timestamp, value] of [...samples].sort((left, right) => left[0] - right[0])) {
    if (value >= highThreshold) {
      current.push([timestamp, value]);
    } else if (current.length) {
      windows.push(summarizeWindow(current));
      current = [];
    }
  }
  if (current.length) windows.push(summarizeWindow(current));
  return windows.slice(0, 20);
}

// Summarizes one continuous above-threshold sample window.
function summarizeWindow(samples) {
  const values = samples.map((sample) => sample[1]);
  const start = samples[0][0];
  const end = samples.at(-1)[0];
  return {
    start_at: new Date(start * 1000).toISOString(),
    end_at: new Date(end * 1000).toISOString(),
    duration_minutes: (end - start) / 60,
    sample_count: samples.length,
    min_value: Math.min(...values),
    max_value: Math.max(...values),
    first_value: values[0],
    last_value: values.at(-1),
  };
}

// Picks the best human-readable cart name from the asset record.
export function inferAssetName(asset, assetId) {
  for (const key of ["name", "displayName", "fleetNumber", "serialNumber", "externalReferenceNumber"]) {
    if (asset[key]) return String(asset[key]);
  }
  return String(findFirstKey(asset, new Set(["name", "displayName", "fleetNumber"])) || assetId);
}

// Gets an AEMP fleet snapshot for fallback equipment-ID matching.
export async function getAempFleetSnapshot(client) {
  // Only used as a fallback when we cannot figure out the AEMP equipment ID directly.
  const result = await client.request("GET", `${AEMP_BASE}/15143/-3/Fleet/1`, {
    query: {
      addMetadata: "true",
      addExtendedData: "true",
      includeOffRentAssets: "true",
    },
    accept: "application/json",
  });
  return isObject(result.body) ? result.body : { raw: result.body };
}

// Searches the AEMP snapshot for the equipment object matching this Trackunit asset.
export function matchAempEquipment(snapshot, assetId, asset) {
  const candidates = new Set(
    [assetId, asset.id, asset.serialNumber, asset.externalReference, asset.name]
      .filter(Boolean)
      .map(String),
  );

  for (const equipment of flattenItems(snapshot)) {
    if (!isObject(equipment)) continue;
    const values = new Set(
      deepIterDicts(equipment)
        .flatMap((item) => Object.values(item))
        .filter((value) => ["string", "number"].includes(typeof value))
        .map(String),
    );
    for (const candidate of candidates) {
      if (values.has(candidate)) return equipment;
    }
  }
  return null;
}

// Builds possible AEMP equipment identifiers, ordered from most likely to least likely.
export function aempIdentifierCandidates(assetId, asset, equipment) {
  // AEMP history wants an equipment identifier, and Trackunit can expose several.
  // Try the most likely ones first so we do less rate-limit-provoking guessing.
  const candidates = [];
  for (const device of asset.telematicsDevices || []) {
    if (!isObject(device)) continue;
    if (device.serialNumber) candidates.push(String(device.serialNumber));
    if (device.id) candidates.push(String(device.id));
  }
  candidates.push(...[asset.serialNumber, asset.externalReference, asset.name, assetId, asset.id].filter(Boolean).map(String));
  if (equipment) {
    for (const item of deepIterDicts(equipment)) {
      for (const key of [
        "MachineId",
        "machineId",
        "EquipmentID",
        "equipmentId",
        "EquipmentId",
        "SerialNumber",
        "serialNumber",
        "PIN",
        "pin",
        "UnitId",
        "unitId",
        "TelematicSerialNumber",
        "telematicSerialNumber",
        "ExternalReferenceNumber",
        "externalReferenceNumber",
      ]) {
        if (item[key] !== undefined && item[key] !== null) candidates.push(String(item[key]));
      }
    }
  }
  return [...new Set(candidates)].filter(Boolean);
}

// Tries candidate AEMP IDs until location history points are found.
export async function resolveAempLocationHistory(client, candidates, start, end, { pageLimit, identifierAttempts, includePoints }) {
  // Walk candidate IDs until one actually returns location points.
  const attempts = [];
  for (const identifier of candidates.slice(0, identifierAttempts)) {
    const history = await getAempLocationHistory(client, identifier, start, end, { pageLimit, includePoints });
    attempts.push(history);
    if ((history.sample_count || 0) > 0) {
      return { available: true, selected_identifier: identifier, attempts, summary: history };
    }
  }
  return {
    available: false,
    selected_identifier: null,
    attempts,
    summary: attempts.at(-1) || { sample_count: 0, available: false },
  };
}

// Reads paged AEMP location history for one identifier.
async function getAempLocationHistory(client, identifier, start, end, { pageLimit, includePoints }) {
  // AEMP is paged. We keep the page count low so local refreshes stay polite.
  const allPoints = [];
  const errors = [];
  let pagesRead = 0;

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const path = `${AEMP_BASE}/15143/-3/Fleet/Equipment/ID/${encodeURIComponent(identifier)}/Locations/${encodeURIComponent(isoZ(start))}/${encodeURIComponent(isoZ(end))}/${pageNumber}`;
    try {
      const result = await client.request("GET", path, { accept: "application/json" });
      pagesRead += 1;
      const points = extractLocationPoints(result.body);
      allPoints.push(...points);
      if (!hasNextLink(findFirstKey(result.body, new Set(["Links", "links"]))) || !points.length) break;
    } catch (error) {
      errors.push(error.message);
      break;
    }
  }

  return {
    identifier,
    pages_read: pagesRead,
    errors,
    ...pointSummary(dedupePoints(allPoints), { includePoints }),
  };
}

// Extracts latitude/longitude/timestamp points from an AEMP response.
function extractLocationPoints(body) {
  // Dig through the whole response because AEMP nesting is not always friendly.
  const points = [];
  for (const item of deepIterDicts(body)) {
    const latitude = toFloat(getCi(item, "latitude", "Latitude"));
    const longitude = toFloat(getCi(item, "longitude", "Longitude"));
    if (latitude === null || longitude === null) continue;
    points.push({
      timestamp:
        item.datetime ||
        item.dateTime ||
        item.timestamp ||
        item.eventDateTime ||
        findFirstKey(item, new Set(["datetime", "dateTime", "timestamp", "eventDateTime"])),
      latitude,
      longitude,
      altitude: toFloat(getCi(item, "altitude", "Altitude")),
    });
  }
  return points;
}

// Summarizes point count and spacing, optionally including the raw points.
function pointSummary(points, { includePoints = false } = {}) {
  // Quick quality read: enough samples and not too spread out means a better heatmap.
  if (!points.length) return { sample_count: 0, available: false, heatmap_feasibility: "no_points" };

  const timestamps = points
    .map((point) => parseTimestamp(point.timestamp || point.datetime || point.updatedAt))
    .filter((timestamp) => timestamp !== null)
    .sort((left, right) => left - right);
  const intervals = [];
  for (let index = 1; index < timestamps.length; index += 1) {
    if (timestamps[index] >= timestamps[index - 1]) {
      intervals.push((timestamps[index] - timestamps[index - 1]) / 60);
    }
  }

  const averageInterval = intervals.length ? intervals.reduce((total, value) => total + value, 0) / intervals.length : null;
  const maxGap = intervals.length ? Math.max(...intervals) : null;
  let feasibility = "good";
  if (points.length < 10) feasibility = "too_sparse";
  else if (averageInterval !== null && averageInterval > 30) feasibility = "coarse";
  else if (averageInterval !== null && averageInterval > 10) feasibility = "usable_but_sparse";

  const summary = {
    available: true,
    sample_count: points.length,
    first_at: timestamps.length ? new Date(timestamps[0] * 1000).toISOString() : null,
    last_at: timestamps.length ? new Date(timestamps.at(-1) * 1000).toISOString() : null,
    average_interval_minutes: averageInterval,
    max_gap_minutes: maxGap,
    heatmap_feasibility: feasibility,
    preview_points: points.slice(0, 5),
  };
  if (includePoints) summary.points = points;
  return summary;
}

// Checks whether an AEMP response says another page is available.
function hasNextLink(links) {
  return Array.isArray(links) && links.some((link) => isObject(link) && String(link.rel || "").toLowerCase() === "next");
}

// Removes duplicate location samples.
function dedupePoints(points) {
  const seen = new Set();
  const deduped = [];
  for (const point of points) {
    const key = [point.timestamp, Number(point.latitude || 0).toFixed(7), Number(point.longitude || 0).toFixed(7)].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(point);
  }
  return deduped;
}

// Counts coordinate pairs in a polygon-like object.
function countCoordinatePairs(value) {
  if (isObject(value)) {
    const latitude = toFloat(getCi(value, "latitude", "Latitude", "lat", "Lat"));
    const longitude = toFloat(getCi(value, "longitude", "Longitude", "lng", "Lng", "lon", "Lon"));
    if (latitude !== null && longitude !== null) return 1;
    return Object.values(value).reduce((count, item) => count + countCoordinatePairs(item), 0);
  }
  if (Array.isArray(value)) {
    if (value.length >= 2 && toFloat(value[0]) !== null && toFloat(value[1]) !== null) return 1;
    return value.reduce((count, item) => count + countCoordinatePairs(item), 0);
  }
  return 0;
}

// Extracts normalized {latitude, longitude} pairs from nested polygon coordinates.
function extractCoordinatePairs(value) {
  const pairs = [];
  if (isObject(value)) {
    const latitude = toFloat(getCi(value, "latitude", "Latitude", "lat", "Lat"));
    const longitude = toFloat(getCi(value, "longitude", "Longitude", "lng", "Lng", "lon", "Lon"));
    if (latitude !== null && longitude !== null) return [{ latitude, longitude }];
    for (const item of Object.values(value)) pairs.push(...extractCoordinatePairs(item));
  } else if (Array.isArray(value)) {
    if (value.length >= 2 && toFloat(value[0]) !== null && toFloat(value[1]) !== null) {
      // GeoJSON-style arrays are usually [longitude, latitude].
      pairs.push({ latitude: toFloat(value[1]), longitude: toFloat(value[0]) });
    } else {
      for (const item of value) pairs.push(...extractCoordinatePairs(item));
    }
  }
  return pairs;
}

// Formats Date objects as Trackunit-friendly UTC ISO strings.
function isoZ(value) {
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
}
