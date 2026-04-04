# LILA BLACK Player Journey Explorer

Browser-based visualization tool for exploring player telemetry across the three LILA BLACK maps.

## Stack

- Static HTML, CSS, and vanilla JavaScript for the browser UI
- Python 3.11 with `pyarrow` for parquet ingestion and dataset preprocessing
- Vercel-ready static deployment

## What the tool does

- Loads the provided parquet telemetry and converts it to browser-friendly JSON
- Maps world coordinates onto the provided 1024x1024 minimaps using the supplied origin and scale per map
- Maps humans and bots with distinct path and marker styling
- Supports filtering by map, date, and match
- Includes playback controls to scrub or animate a match over time
- Offers heatmaps for traffic, kill zones, death zones, loot density, and storm deaths

## Local setup

1. Ensure Python 3.11+ is installed.
2. Rebuild the processed dataset:

```bash
python scripts/build_dataset.py
```

3. Serve the repository root with any static server. For example:

```bash
python -m http.server 8000
```

4. Open `http://localhost:8000`.

## Data notes

- Raw telemetry is kept under `player_data/`
- Generated browser assets are written to `data/`
- Minimap images are served from `assets/minimaps/`

## Environment variables

None required for the static experience.

