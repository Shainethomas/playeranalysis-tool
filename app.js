const state = {
  manifest: null,
  aggregatePoints: [],
  matchData: null,
  selectedMap: "all",
  selectedDate: "all",
  selectedMatch: "",
  heatmapMode: "none",
  showHumans: true,
  showBots: true,
  eventFilters: new Set(["Loot", "Kill", "Killed", "BotKill", "BotKilled", "KilledByStorm"]),
  playing: false,
  speed: 1,
  playbackMs: 0,
  lastFrame: 0,
  imageCache: new Map(),
  baseCanvas: document.createElement("canvas"),
  baseDirty: true,
  lastHudText: "",
};

const els = {
  mapFilter: document.getElementById("mapFilter"),
  dateFilter: document.getElementById("dateFilter"),
  matchFilter: document.getElementById("matchFilter"),
  summaryCards: document.getElementById("summaryCards"),
  mapTitle: document.getElementById("mapTitle"),
  playPauseBtn: document.getElementById("playPauseBtn"),
  speedSelect: document.getElementById("speedSelect"),
  timelineSlider: document.getElementById("timelineSlider"),
  timeLabel: document.getElementById("timeLabel"),
  matchMeta: document.getElementById("matchMeta"),
  heatmapMode: document.getElementById("heatmapMode"),
  showHumans: document.getElementById("showHumans"),
  showBots: document.getElementById("showBots"),
  canvas: document.getElementById("mapCanvas"),
};

const ctx = els.canvas.getContext("2d");

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
    state.selectedMatch = event.target.value;
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
    draw();
  });

  els.heatmapMode.addEventListener("change", (event) => {
    state.heatmapMode = event.target.value;
    state.baseDirty = true;
    draw();
  });

  els.showHumans.addEventListener("change", (event) => {
    state.showHumans = event.target.checked;
    draw();
  });

  els.showBots.addEventListener("change", (event) => {
    state.showBots = event.target.checked;
    draw();
  });

  document.querySelectorAll(".event-toggle").forEach((input) => {
    input.addEventListener("change", (event) => {
      const eventName = event.target.dataset.event;
      if (event.target.checked) {
        state.eventFilters.add(eventName);
      } else {
        state.eventFilters.delete(eventName);
      }
      draw();
    });
  });

  await refreshMatches();
  requestAnimationFrame(tick);
}

async function refreshMatches() {
  const matches = getFilteredMatches();
  populateSelect(
    els.matchFilter,
    matches.map((match) => match.id),
    matches.length ? null : "No matches"
  );
  state.selectedMatch = matches[0]?.id ?? "";
  await loadSelectedMatch();
}

async function loadSelectedMatch() {
  const matchMeta = state.manifest.matches.find((match) => match.id === state.selectedMatch);
  if (!matchMeta) {
    state.matchData = null;
    draw();
    return;
  }

  state.matchData = await fetchJson(`data/matches/${matchMeta.slug}.json`);
  state.playbackMs = 0;
  state.baseDirty = true;
  state.lastHudText = "";
  els.timelineSlider.value = "0";
  await ensureMapImage(state.matchData.mapId);
  updateSummaryCards(matchMeta);
  draw();
}

function getFilteredMatches() {
  return state.manifest.matches.filter((match) => {
    const mapOk = state.selectedMap === "all" || match.mapId === state.selectedMap;
    const dateOk = state.selectedDate === "all" || match.date === state.selectedDate;
    return mapOk && dateOk;
  });
}

function updateSummaryCards(matchMeta) {
  const cards = [
    { label: "Players", value: matchMeta.playerCount },
    { label: "Humans", value: matchMeta.humanCount },
    { label: "Bots", value: matchMeta.botCount },
    { label: "Duration", value: formatDuration(matchMeta.durationMs) },
  ];
  els.summaryCards.innerHTML = cards
    .map(
      (card) =>
        `<div class="stat-card"><strong>${card.value}</strong><span>${card.label}</span></div>`
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
    draw();
  }
  state.lastFrame = timestamp;
  requestAnimationFrame(tick);
}

function draw() {
  if (!state.matchData) {
    drawEmptyState();
    return;
  }

  const mapImage = state.imageCache.get(state.matchData.mapId);
  if (!mapImage) {
    drawEmptyState();
    return;
  }

  drawBaseLayer(mapImage);
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  ctx.drawImage(state.baseCanvas, 0, 0);
  drawPaths();
  drawMarkers();
  drawHud();
}

function drawBaseLayer(mapImage) {
  if (!state.baseDirty) return;

  state.baseCanvas.width = els.canvas.width;
  state.baseCanvas.height = els.canvas.height;
  const baseCtx = state.baseCanvas.getContext("2d");
  baseCtx.clearRect(0, 0, state.baseCanvas.width, state.baseCanvas.height);
  baseCtx.drawImage(mapImage, 0, 0, state.baseCanvas.width, state.baseCanvas.height);
  drawHeatmap(baseCtx);
  state.baseDirty = false;
}

function drawEmptyState() {
  ctx.fillStyle = "#071018";
  ctx.fillRect(0, 0, els.canvas.width, els.canvas.height);
  ctx.fillStyle = "#eff6fb";
  ctx.font = "28px Segoe UI";
  ctx.fillText("No match available for current filters", 80, 140);
}

function drawHeatmap(targetCtx) {
  if (state.heatmapMode === "none") return;

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

  const gridSize = 32;
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
    targetCtx.fillStyle = heatColor(intensity, state.heatmapMode);
    targetCtx.fillRect(gx * gridSize, gy * gridSize, gridSize, gridSize);
  }
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
    ctx.save();
    ctx.strokeStyle = bot ? "rgba(255, 184, 77, 0.68)" : "rgba(85, 230, 193, 0.72)";
    ctx.lineWidth = bot ? 1.3 : 1.8;
    if (bot) ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(pathRows[0].px, pathRows[0].py);
    for (const row of pathRows.slice(1)) {
      ctx.lineTo(row.px, row.py);
    }
    ctx.stroke();

    const last = pathRows[pathRows.length - 1];
    ctx.fillStyle = bot ? "#ffb84d" : "#55e6c1";
    ctx.beginPath();
    ctx.arc(last.px, last.py, bot ? 3.5 : 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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

    ctx.fillStyle = fill;
    ctx.strokeStyle = "rgba(10,18,25,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(row.px, row.py, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawHud() {
  const currentMeta = state.manifest.matches.find((match) => match.id === state.matchData.id);
  const mapTitle = state.matchData.mapId;
  const timeLabel = formatDuration(state.playbackMs);
  const matchMeta = `${state.matchData.date} | ${currentMeta.playerCount} players | ${state.matchData.id.slice(0, 8)}...`;
  const nextHudText = `${mapTitle}__${timeLabel}__${matchMeta}`;
  if (nextHudText === state.lastHudText) return;
  state.lastHudText = nextHudText;
  els.mapTitle.textContent = mapTitle;
  els.timeLabel.textContent = timeLabel;
  els.matchMeta.textContent = matchMeta;
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

  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value === "all" ? emptyLabel ?? value : value;
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
