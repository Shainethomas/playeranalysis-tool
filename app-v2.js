const state = {
  manifest: null,
  aggregatePoints: [],
  matchData: null,
  selectedMap: "all",
  selectedDate: "all",
  selectedMatchKey: "",
  heatmapMode: "none",
  showHumans: true,
  showBots: true,
  eventFilters: new Set(["Loot", "Kill", "Killed", "BotKill", "BotKilled", "KilledByStorm"]),
  playing: false,
  speed: 1,
  playbackMs: 0,
  lastFrame: 0,
  imageCache: new Map(),
  heatmapDirty: true,
  lastHudText: "",
};

const els = {
  mapFilter: document.getElementById("mapFilter"),
  dateFilter: document.getElementById("dateFilter"),
  matchFilter: document.getElementById("matchFilter"),
  summaryCards: document.getElementById("summaryCards"),
  stageMetrics: document.getElementById("stageMetrics"),
  mapTitle: document.getElementById("mapTitle"),
  playPauseBtn: document.getElementById("playPauseBtn"),
  speedSelect: document.getElementById("speedSelect"),
  timelineSlider: document.getElementById("timelineSlider"),
  timeLabel: document.getElementById("timeLabel"),
  matchMeta: document.getElementById("matchMeta"),
  heatmapMode: document.getElementById("heatmapMode"),
  showHumans: document.getElementById("showHumans"),
  showBots: document.getElementById("showBots"),
  mapImage: document.getElementById("mapImage"),
  heatmapCanvas: document.getElementById("heatmapCanvas"),
  overlayCanvas: document.getElementById("overlayCanvas"),
};

const overlayCtx = els.overlayCanvas.getContext("2d");
const heatmapCtx = els.heatmapCanvas.getContext("2d");

init().catch((error) => {
  console.error(error);
  els.mapTitle.textContent = "Failed to load data";
});

async function init() {
  const [manifest, aggregate] = await Promise.all([
    fetchJson("data/manifest.json"),
    fetchJson("data/aggregate-points.json"),
  ]);

  state.manifest = manifest;
  state.aggregatePoints = aggregate.points;

  populateSelect(els.mapFilter, ["all", ...Object.keys(manifest.maps)], "All maps");
  populateSelect(els.dateFilter, ["all", ...manifest.dates], "All dates");

  els.mapFilter.addEventListener("change", async (event) => {
    state.selectedMap = event.target.value;
    await refreshMatches();
  });

  els.dateFilter.addEventListener("change", async (event) => {
    state.selectedDate = event.target.value;
    await refreshMatches();
  });

  els.matchFilter.addEventListener("change", async (event) => {
    state.selectedMatchKey = event.target.value;
    await loadSelectedMatch();
  });

  els.playPauseBtn.addEventListener("click", () => {
    state.playing = !state.playing;
    els.playPauseBtn.textContent = state.playing ? "Pause" : "Play";
  });

  els.speedSelect.addEventListener("change", (event) => {
    state.speed = Number(event.target.value);
  });

  els.timelineSlider.addEventListener("input", (event) => {
    if (!state.matchData) return;
    const ratio = Number(event.target.value) / 1000;
    state.playbackMs = Math.round(ratio * state.matchData.durationMs);
    drawOverlay();
  });

  els.heatmapMode.addEventListener("change", (event) => {
    state.heatmapMode = event.target.value;
    state.heatmapDirty = true;
    drawHeatmapLayer();
    updateStageMetrics(getCurrentMatchMeta());
  });

  els.showHumans.addEventListener("change", (event) => {
    state.showHumans = event.target.checked;
    drawOverlay();
  });

  els.showBots.addEventListener("change", (event) => {
    state.showBots = event.target.checked;
    drawOverlay();
  });

  document.querySelectorAll(".event-toggle").forEach((input) => {
    input.addEventListener("change", (event) => {
      const eventName = event.target.dataset.event;
      if (event.target.checked) {
        state.eventFilters.add(eventName);
      } else {
        state.eventFilters.delete(eventName);
      }
      drawOverlay();
    });
  });

  await refreshMatches();
  requestAnimationFrame(tick);
}

function getCurrentMatchMeta() {
  return (
    state.manifest?.matches.find((match) => `${match.date}__${match.id}` === state.selectedMatchKey) ?? null
  );
}

async function refreshMatches() {
  const matches = getFilteredMatches();
  populateSelect(
    els.matchFilter,
    matches.map((match) => ({
      value: `${match.date}__${match.id}`,
      label: `${match.date} | ${match.playerCount} players (${match.humanCount}H/${match.botCount}B) | ${match.id.slice(0, 8)}...`,
    })),
    matches.length ? null : "No matches"
  );
  state.selectedMatchKey = matches[0] ? `${matches[0].date}__${matches[0].id}` : "";
  await loadSelectedMatch();
}

async function loadSelectedMatch() {
  const matchMeta = getCurrentMatchMeta();
  if (!matchMeta) {
    state.matchData = null;
    clearLayers();
    drawEmptyState();
    return;
  }

  state.matchData = await fetchJson(`data/matches/${matchMeta.slug}.json`);
  state.playbackMs = 0;
  state.heatmapDirty = true;
  state.lastHudText = "";
  els.timelineSlider.value = "0";

  const image = await ensureMapImage(state.matchData.mapId);
  els.mapImage.src = image.src;

  updateSummaryCards(matchMeta);
  updateStageMetrics(matchMeta);
  drawHeatmapLayer();
  drawOverlay();
}

function getFilteredMatches() {
  return state.manifest.matches
    .filter((match) => {
      const mapOk = state.selectedMap === "all" || match.mapId === state.selectedMap;
      const dateOk = state.selectedDate === "all" || match.date === state.selectedDate;
      return mapOk && dateOk;
    })
    .sort((a, b) => {
      if (b.playerCount !== a.playerCount) return b.playerCount - a.playerCount;
      if (b.humanCount !== a.humanCount) return b.humanCount - a.humanCount;
      return a.id.localeCompare(b.id);
    });
}

function updateSummaryCards(matchMeta) {
  const cards = [
    { label: "Players", value: matchMeta.playerCount },
    { label: "Humans", value: matchMeta.humanCount },
    { label: "Bots", value: matchMeta.botCount },
    { label: "Replay", value: formatDuration(matchMeta.durationMs) },
  ];
  els.summaryCards.innerHTML = cards
    .map(
      (card) =>
        `<div class="stat-card"><strong>${card.value}</strong><span>${card.label}</span></div>`
    )
    .join("");
}

function updateStageMetrics(matchMeta) {
  if (!matchMeta) {
    els.stageMetrics.innerHTML = "";
    return;
  }

  const killCount = (matchMeta.eventCounts.Kill ?? 0) + (matchMeta.eventCounts.BotKill ?? 0);
  const deathCount =
    (matchMeta.eventCounts.Killed ?? 0) +
    (matchMeta.eventCounts.BotKilled ?? 0) +
    (matchMeta.eventCounts.KilledByStorm ?? 0);
  const lootCount = matchMeta.eventCounts.Loot ?? 0;
  const pressure =
    matchMeta.botCount > matchMeta.humanCount ? "Bot-heavy" : matchMeta.humanCount > 1 ? "PvP-ready" : "Solo trace";
  const replayMode = state.heatmapMode === "none" ? "Paths + Events" : "Heatmap + Replay";

  const metrics = [
    { label: "Combat events", value: killCount + deathCount },
    { label: "Loot picks", value: lootCount },
    { label: "Pressure", value: pressure },
    { label: "View mode", value: replayMode },
  ];

  els.stageMetrics.innerHTML = metrics
    .map(
      (metric) =>
        `<div class="metric-pill"><span>${metric.label}</span><strong>${metric.value}</strong></div>`
    )
    .join("");
}

async function ensureMapImage(mapId) {
  if (state.imageCache.has(mapId)) return state.imageCache.get(mapId);
  const img = new Image();
  img.src = state.manifest.maps[mapId].image;
  await img.decode();
  state.imageCache.set(mapId, img);
  return img;
}

function tick(timestamp) {
  if (state.playing && state.matchData) {
    if (!state.lastFrame) state.lastFrame = timestamp;
    const delta = timestamp - state.lastFrame;
    state.playbackMs = Math.min(state.playbackMs + delta * state.speed, state.matchData.durationMs);
    const ratio = state.matchData.durationMs ? state.playbackMs / state.matchData.durationMs : 0;
    els.timelineSlider.value = String(Math.round(ratio * 1000));
    if (state.playbackMs >= state.matchData.durationMs) {
      state.playing = false;
      els.playPauseBtn.textContent = "Play";
    }
    drawOverlay();
  }
  state.lastFrame = timestamp;
  requestAnimationFrame(tick);
}

function clearLayers() {
  heatmapCtx.clearRect(0, 0, els.heatmapCanvas.width, els.heatmapCanvas.height);
  overlayCtx.clearRect(0, 0, els.overlayCanvas.width, els.overlayCanvas.height);
}

function drawHeatmapLayer() {
  heatmapCtx.clearRect(0, 0, els.heatmapCanvas.width, els.heatmapCanvas.height);
  if (!state.matchData || !state.heatmapDirty || state.heatmapMode === "none") return;

  const relevantPoints = state.aggregatePoints.filter((point) => {
    if (point.mapId !== state.matchData.mapId) return false;
    if (state.selectedDate !== "all" && point.date !== state.selectedDate) return false;

    switch (state.heatmapMode) {
      case "traffic":
        return point.event === "Position" || point.event === "BotPosition";
      case "kills":
        return point.event === "Kill" || point.event === "BotKill";
      case "deaths":
        return point.event === "Killed" || point.event === "BotKilled" || point.event === "KilledByStorm";
      case "loot":
        return point.event === "Loot";
      case "storm":
        return point.event === "KilledByStorm";
      default:
        return false;
    }
  });

  const gridSize = 28;
  const grid = new Map();
  let maxCount = 0;

  for (const point of relevantPoints) {
    const gx = Math.floor(point.px / gridSize);
    const gy = Math.floor(point.py / gridSize);
    const key = `${gx}:${gy}`;
    const next = (grid.get(key) ?? 0) + 1;
    grid.set(key, next);
    if (next > maxCount) maxCount = next;
  }

  for (const [key, count] of grid.entries()) {
    const [gx, gy] = key.split(":").map(Number);
    const intensity = maxCount ? count / maxCount : 0;
    heatmapCtx.fillStyle = heatColor(intensity, state.heatmapMode);
    heatmapCtx.fillRect(gx * gridSize, gy * gridSize, gridSize, gridSize);
  }

  state.heatmapDirty = false;
}

function drawOverlay() {
  overlayCtx.clearRect(0, 0, els.overlayCanvas.width, els.overlayCanvas.height);

  if (!state.matchData) {
    drawEmptyState();
    return;
  }

  drawPaths();
  drawMarkers();
  drawHud();
}

function drawEmptyState() {
  overlayCtx.fillStyle = "rgba(7, 16, 24, 0.72)";
  overlayCtx.fillRect(0, 0, els.overlayCanvas.width, els.overlayCanvas.height);
  overlayCtx.fillStyle = "#eff6fb";
  overlayCtx.font = "28px Segoe UI";
  overlayCtx.fillText("No match available for current filters", 88, 140);
}

function drawPaths() {
  const rows = state.matchData.events.filter((row) => {
    if (row.offsetMs > state.playbackMs) return false;
    if (!showEntity(row.bot)) return false;
    return row.event === "Position" || row.event === "BotPosition";
  });

  const grouped = groupBy(rows, (row) => row.userId);
  for (const pathRows of grouped.values()) {
    if (pathRows.length < 2) continue;
    const bot = pathRows[0].bot;

    overlayCtx.save();
    overlayCtx.strokeStyle = bot ? "rgba(255, 184, 77, 0.86)" : "rgba(85, 230, 193, 0.92)";
    overlayCtx.shadowColor = bot ? "rgba(255, 184, 77, 0.18)" : "rgba(85, 230, 193, 0.2)";
    overlayCtx.shadowBlur = 10;
    overlayCtx.lineWidth = bot ? 1.5 : 2.2;
    overlayCtx.lineCap = "round";
    overlayCtx.lineJoin = "round";
    if (bot) overlayCtx.setLineDash([7, 7]);

    overlayCtx.beginPath();
    overlayCtx.moveTo(pathRows[0].px, pathRows[0].py);
    for (const row of pathRows.slice(1)) {
      overlayCtx.lineTo(row.px, row.py);
    }
    overlayCtx.stroke();

    const last = pathRows[pathRows.length - 1];
    overlayCtx.fillStyle = bot ? "#ffb84d" : "#55e6c1";
    overlayCtx.beginPath();
    overlayCtx.arc(last.px, last.py, bot ? 4 : 5, 0, Math.PI * 2);
    overlayCtx.fill();
    overlayCtx.restore();
  }
}

function drawMarkers() {
  const rows = state.matchData.events.filter((row) => {
    if (row.offsetMs > state.playbackMs) return false;
    if (!showEntity(row.bot)) return false;
    return state.eventFilters.has(row.event);
  });

  for (const row of rows) {
    let fill = "#ffffff";
    let radius = 5;
    if (row.event === "Loot") fill = "#7dcfff";
    if (row.event === "Kill" || row.event === "BotKill") fill = "#ff7f50";
    if (row.event === "Killed" || row.event === "BotKilled") fill = "#ff6a6a";
    if (row.event === "KilledByStorm") {
      fill = "#f2f06b";
      radius = 6;
    }

    overlayCtx.fillStyle = fill;
    overlayCtx.strokeStyle = "rgba(10,18,25,0.85)";
    overlayCtx.lineWidth = 2;
    overlayCtx.beginPath();
    overlayCtx.arc(row.px, row.py, radius, 0, Math.PI * 2);
    overlayCtx.fill();
    overlayCtx.stroke();
  }
}

function drawHud() {
  const currentMeta = getCurrentMatchMeta();
  const mapTitle = state.matchData.mapId;
  const timeLabel = formatDuration(state.playbackMs);
  const matchMeta = `${state.matchData.date} | ${currentMeta.playerCount} players | ${state.matchData.id.slice(0, 8)}...`;
  const nextHudText = `${mapTitle}__${timeLabel}__${matchMeta}`;
  if (nextHudText !== state.lastHudText) {
    state.lastHudText = nextHudText;
    els.mapTitle.textContent = mapTitle;
    els.matchMeta.textContent = matchMeta;
  }
  els.timeLabel.textContent = timeLabel;
}

function populateSelect(select, values, emptyLabel) {
  select.innerHTML = "";
  if (values.length === 0 && emptyLabel) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    select.appendChild(option);
    return;
  }

  for (const item of values) {
    const option = document.createElement("option");
    if (typeof item === "string") {
      option.value = item;
      option.textContent = item === "all" ? emptyLabel ?? item : item;
    } else {
      option.value = item.value;
      option.textContent = item.label;
    }
    select.appendChild(option);
  }
}

function showEntity(bot) {
  return bot ? state.showBots : state.showHumans;
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const millis = String(ms % 1000).padStart(3, "0");
  return `${minutes}:${seconds}.${millis}`;
}

function heatColor(intensity, mode) {
  const alpha = Math.max(0.08, intensity * 0.72);
  if (mode === "traffic") return `rgba(85,230,193,${alpha})`;
  if (mode === "kills") return `rgba(255,127,80,${alpha})`;
  if (mode === "deaths") return `rgba(255,106,106,${alpha})`;
  if (mode === "loot") return `rgba(125,207,255,${alpha})`;
  return `rgba(242,240,107,${alpha})`;
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}`);
  }
  return response.json();
}
