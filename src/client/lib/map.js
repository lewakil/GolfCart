const VIEWBOX = { width: 1200, height: 660, pad: 52 };
const TILE_ZOOM = 15;
const MAX_TILES = 80;

export function buildMapModel({ sites = [], assets = [] }) {
  const coordinates = collectCoordinates(sites, assets);
  const bounds = mercatorBounds(coordinates);
  const projection = createProjection(bounds);

  return {
    ...VIEWBOX,
    bounds,
    projection,
    tiles: buildTiles(bounds, projection),
  };
}

export function projectPoint(projection, point) {
  if (!hasCoordinates(point)) return null;
  const projected = mercator(point.latitude, point.longitude);
  return projection(projected);
}

export function projectPolygon(projection, points) {
  return (points || [])
    .map((point) => projectPoint(projection, point))
    .filter(Boolean)
    .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
}

export function siteKind(site) {
  const name = String(site?.name || "");
  const type = String(site?.type || "");
  if (/start|stop|depot/i.test(name) || type === "DEPOT") return "start";
  if (/no.?go/i.test(name) || type === "NO_GO") return "nogo";
  if (/lodging|apartment|villa|suite|guest/i.test(name) || type === "LODGING") return "lodging";
  if (site?.hole || /^North\s+\d+/i.test(name)) return "hole";
  return "zone";
}

export function currentPoint(asset) {
  const location = asset?.current_location;
  if (hasCoordinates(location)) return location;
  return (asset?.points || []).filter(hasCoordinates).at(-1) || null;
}

export function tileUrl(tile) {
  return `https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`;
}

function buildTiles(bounds, projection) {
  const n = 2 ** TILE_ZOOM;
  const minTileX = Math.floor(bounds.minX * n) - 1;
  const maxTileX = Math.floor(bounds.maxX * n) + 1;
  const minTileY = Math.floor(bounds.minY * n) - 1;
  const maxTileY = Math.floor(bounds.maxY * n) + 1;
  const tiles = [];

  for (let x = minTileX; x <= maxTileX; x += 1) {
    for (let y = minTileY; y <= maxTileY; y += 1) {
      if (tiles.length >= MAX_TILES) return tiles;
      const topLeft = projection({ x: x / n, y: y / n });
      const bottomRight = projection({ x: (x + 1) / n, y: (y + 1) / n });
      tiles.push({
        x,
        y,
        z: TILE_ZOOM,
        svgX: topLeft.x,
        svgY: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      });
    }
  }

  return tiles;
}

function createProjection(bounds) {
  const availableWidth = VIEWBOX.width - VIEWBOX.pad * 2;
  const availableHeight = VIEWBOX.height - VIEWBOX.pad * 2;
  const spanX = Math.max(bounds.maxX - bounds.minX, 0.000001);
  const spanY = Math.max(bounds.maxY - bounds.minY, 0.000001);
  const scale = Math.min(availableWidth / spanX, availableHeight / spanY);
  const offsetX = (VIEWBOX.width - spanX * scale) / 2;
  const offsetY = (VIEWBOX.height - spanY * scale) / 2;

  return ({ x, y }) => ({
    x: offsetX + (x - bounds.minX) * scale,
    y: offsetY + (y - bounds.minY) * scale,
  });
}

function mercatorBounds(points) {
  const projected = points.map((point) => mercator(point.latitude, point.longitude));
  const fallback = projected.length ? projected : [mercator(33.49372, -111.93248)];
  const xs = fallback.map((point) => point.x);
  const ys = fallback.map((point) => point.y);
  const padX = Math.max((Math.max(...xs) - Math.min(...xs)) * 0.12, 0.00006);
  const padY = Math.max((Math.max(...ys) - Math.min(...ys)) * 0.12, 0.00006);

  return {
    minX: Math.min(...xs) - padX,
    maxX: Math.max(...xs) + padX,
    minY: Math.min(...ys) - padY,
    maxY: Math.max(...ys) + padY,
  };
}

function collectCoordinates(sites, assets) {
  const fromSites = sites.flatMap((site) => site.polygon_points || []);
  const fromTrails = assets.flatMap((asset) => asset.points || []);
  const fromCurrent = assets.map(currentPoint).filter(Boolean);
  return [...fromSites, ...fromTrails, ...fromCurrent].filter(hasCoordinates);
}

function mercator(latitude, longitude) {
  const sin = Math.sin((latitude * Math.PI) / 180);
  return {
    x: (longitude + 180) / 360,
    y: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI),
  };
}

function hasCoordinates(point) {
  return Number.isFinite(Number(point?.latitude)) && Number.isFinite(Number(point?.longitude));
}
