# Architecture

## What I built and why

I built a static browser app backed by a Python preprocessing script. The dataset is small enough to precompute once, and this approach keeps the frontend fast, easy to host, and easy for reviewers to run locally without standing up a backend.

## Data flow

1. `scripts/build_dataset.py` scans each day folder in `player_data/`.
2. Every `.nakama-0` file is read with `pyarrow.parquet`.
3. The `event` bytes column is decoded to UTF-8 strings.
4. Rows are grouped by `match_id` so a full match can be reconstructed across all player files that share that match.
5. Each row is tagged as `bot` or `human` based on whether `user_id` is numeric.
6. World coordinates are converted to minimap pixel coordinates and saved into JSON.
7. The script emits:
   - `data/manifest.json` for filter controls and match metadata
   - `data/aggregate-points.json` for cross-match heatmaps
   - `data/matches/*.json` for per-match playback
8. The browser app loads the manifest first, then lazy-loads the selected match payload.

## Coordinate mapping approach

The README provided a per-map `scale`, `origin_x`, and `origin_z`, plus the 1024x1024 minimap size. I used the supplied transform exactly:

```text
u = (x - origin_x) / scale
v = (z - origin_z) / scale
pixel_x = u * 1024
pixel_y = (1 - v) * 1024
```

Key implementation details:

- I intentionally ignored the `y` column for map placement because it is elevation, not 2D position.
- I stored both world coordinates and mapped pixel coordinates in the generated JSON so the mapping stays inspectable.
- The frontend draws directly in minimap pixel space, which avoids repeated conversion logic and keeps playback rendering simple.

## Assumptions

- `ts` is best treated as elapsed match time encoded as a timestamp-like value. For playback, I normalize each match by subtracting that match's minimum timestamp.
- Matches with only one file are still valid and render as partial telemetry captures.
- Heatmaps should respond to the selected map and date filters, even when a specific match is selected for playback.

## Tradeoffs

| Decision | Chosen approach | Tradeoff |
|---|---|---|
| Backend vs static | Static site + generated JSON | Simpler hosting, but preprocessing must be rerun when data changes |
| Match loading | Lazy-load one match at a time | Faster first paint, but switching matches triggers a fetch |
| Rendering | Canvas 2D | Great for dense overlays, but less convenient for built-in hover tooling than SVG |
| Heatmaps | Aggregated grid heatmap on the client | Lightweight and dependency-free, but less visually smooth than kernel-density libraries |
