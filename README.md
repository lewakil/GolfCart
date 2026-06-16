# Golf Cart Tracker

Golf Cart Tracker is a full-stack React and Node application for monitoring a golf cart fleet in real time. It tracks cart availability, GPS position, active trips, route progress, battery health, geofence events, upcoming reservations, and maintenance work from a single operations dashboard.

The app runs out of the box with a deterministic demo telemetry provider, so reviewers can clone the repository and inspect the product without private fleet credentials. A Trackunit-backed provider is also available for live telemetry integrations.

## Features

- React dashboard with live map, fleet table, cart detail panel, trip board, alert queue, and maintenance queue
- Demo telemetry provider for portfolio review and local development
- Optional Trackunit provider for real assets, latest location, sites, time-series metrics, and AEMP history
- Geofence overlays for Start / Stop, no-go zones, lodging areas, and course holes
- Battery and charging signals with low-charge alerts
- Active-trip tracking with route progress, expected return estimates, and trip mileage
- Maintenance prioritization from service due dates, odometer readings, and current bay status
- Production server that serves the React build and exposes JSON API endpoints

## Tech Stack

- React 19
- Vite
- Node.js HTTP server
- lucide-react icons
- OpenStreetMap raster tiles for map context
- Provider-based data layer for demo and live telemetry sources

## Quick Start

```sh
npm install
npm run dev
```

Open the app at:

```text
http://127.0.0.1:5173/
```

The development command starts both the Node API on port `8765` and the Vite React dev server on port `5173`.

## Production Preview

```sh
npm start
```

Then open:

```text
http://127.0.0.1:8765/
```

`npm start` builds the React app and serves the bundled dashboard from the Node server.

## Live Telemetry

The default provider is `demo`. To run against Trackunit, create a `.env` file from `.env.example` and set:

```sh
GOLF_CART_PROVIDER=trackunit
```

Then run:

```sh
npm run start:trackunit
```

Supported credential styles are documented in `.env.example`. The server keeps Trackunit-specific logic isolated in `src/server/services/trackunit-dashboard-service.js`, while the React app consumes the same normalized dashboard JSON used by demo mode.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start demo API and Vite dev server |
| `npm run dev:api` | Start only the demo API |
| `npm run dev:api:trackunit` | Start only the Trackunit API provider |
| `npm run build` | Build the React app into `dist/` |
| `npm start` | Build and serve the demo app from Node |
| `npm run start:trackunit` | Build and serve the Trackunit-backed app |
| `npm stop` | Stop the local server on port `8765` |

## Project Structure

```text
.
├── src
│   ├── client
│   │   ├── components        # React feature components
│   │   ├── lib               # Formatting, map projection, and data normalization
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── server
│   │   ├── integrations      # Vendor/API clients
│   │   ├── providers         # Demo and live dashboard providers
│   │   ├── services          # Telemetry normalization and fleet rules
│   │   └── index.js          # API and production static server
│   └── trip-history.json     # Local trip-learning store for live provider experiments
├── scripts
├── index.html
├── vite.config.js
└── README.md
```

## API

The React client reads one dashboard payload:

```text
GET /api/dashboard
GET /api/dashboard?refresh=1
```

The server also exposes:

```text
GET /api/health
```

The provider contract returns normalized fields for:

- `rows`: fleet table rows
- `trip_rows`: active trip rows
- `heatmap_assets`: GPS trail and current-location data
- `sites`: polygons for map overlays
- `alerts`: current operational alerts
- `maintenance_queue`: service priorities
- `fleet_summary`: top-level KPI counts
- `charging_insights`: charging recommendations

## Design Notes

- Demo data is deterministic and realistic enough for UI testing, interviews, and screenshots.
- Vendor-specific Trackunit calls are isolated from React components.
- UI components are organized by workflow instead of by page section only.
- Map rendering is intentionally lightweight: Web Mercator projection plus SVG overlays on OpenStreetMap tiles.
- Comments are kept focused around non-obvious telemetry rules, provider boundaries, and map math.
