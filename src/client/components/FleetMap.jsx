import { Layers, LocateFixed, Route } from "lucide-react";
import { useMemo, useState } from "react";
import { buildMapModel, currentPoint, projectPoint, projectPolygon, siteKind, tileUrl } from "../lib/map.js";

export function FleetMap({ assets, carts, selectedCartId, sites, onSelectCart }) {
  const [showZones, setShowZones] = useState(true);
  const [showTrails, setShowTrails] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const cartById = useMemo(() => new Map(carts.map((cart) => [cart.assetId, cart])), [carts]);
  const model = useMemo(() => buildMapModel({ sites, assets }), [sites, assets]);

  return (
    <section className="panel map-panel">
      <div className="panel-heading map-heading">
        <div>
          <h2>Live Map</h2>
          <p>{assets.length} tracked carts</p>
        </div>
        <div className="map-controls" aria-label="Map layers">
          <LayerToggle checked={showZones} icon={Layers} label="Zones" onChange={setShowZones} />
          <LayerToggle checked={showTrails} icon={Route} label="Trails" onChange={setShowTrails} />
          <LayerToggle checked={showLabels} icon={LocateFixed} label="Labels" onChange={setShowLabels} />
        </div>
      </div>

      <div className="map-canvas">
        <svg viewBox={`0 0 ${model.width} ${model.height}`} role="img" aria-label="Golf cart fleet map">
          <defs>
            <filter id="markerShadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="3" floodColor="#102016" floodOpacity="0.28" stdDeviation="3" />
            </filter>
          </defs>

          <g className="tile-layer">
            {model.tiles.map((tile) => (
              <image
                height={tile.height}
                href={tileUrl(tile)}
                key={`${tile.z}-${tile.x}-${tile.y}`}
                preserveAspectRatio="none"
                width={tile.width}
                x={tile.svgX}
                y={tile.svgY}
              />
            ))}
          </g>

          {showTrails && (
            <g className="trail-layer">
              {assets.map((asset) => {
                const points = (asset.points || [])
                  .map((point) => projectPoint(model.projection, point))
                  .filter(Boolean)
                  .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
                  .join(" ");
                return points ? <polyline key={asset.asset_id} points={points} /> : null;
              })}
              {assets.flatMap((asset) => (asset.points || []).filter((_, index) => index % 4 === 0).map((point, index) => {
                const projected = projectPoint(model.projection, point);
                if (!projected) return null;
                return <circle className="density-dot" cx={projected.x} cy={projected.y} key={`${asset.asset_id}-${index}`} r="3.5" />;
              }))}
            </g>
          )}

          {showZones && (
            <g className="zone-layer">
              {sites.map((site) => {
                const points = projectPolygon(model.projection, site.polygon_points);
                if (!points) return null;
                const kind = siteKind(site);
                return (
                  <polygon className={`zone zone-${kind}`} key={site.id || site.name} points={points}>
                    <title>{site.name}</title>
                  </polygon>
                );
              })}
            </g>
          )}

          <g className="cart-layer">
            {assets.map((asset) => {
              const cart = cartById.get(asset.asset_id);
              const projected = projectPoint(model.projection, currentPoint(asset));
              if (!projected) return null;
              const selected = selectedCartId === asset.asset_id;
              return (
                <g
                  aria-label={`Select ${asset.name}`}
                  className={`cart-marker marker-${cart?.status || "unknown"} ${selected ? "selected" : ""}`}
                  key={asset.asset_id}
                  onClick={() => onSelectCart(asset.asset_id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") onSelectCart(asset.asset_id);
                  }}
                  role="button"
                  tabIndex="0"
                  transform={`translate(${projected.x.toFixed(1)} ${projected.y.toFixed(1)})`}
                >
                  <circle r={selected ? 13 : 10} />
                  <path d="M-4 -1h8l2 4H-6z" />
                  {showLabels && (
                    <text x="16" y="5">
                      {asset.name}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        <div className="map-attribution">Map data © OpenStreetMap contributors</div>
      </div>
    </section>
  );
}

function LayerToggle({ checked, icon: Icon, label, onChange }) {
  return (
    <label className={`layer-toggle ${checked ? "active" : ""}`}>
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <Icon size={15} aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
