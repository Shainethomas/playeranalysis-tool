import json
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import pyarrow.parquet as pq


ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = ROOT / "player_data"
OUTPUT_ROOT = ROOT / "data"

MAP_CONFIG = {
    "AmbroseValley": {
        "scale": 900,
        "originX": -370,
        "originZ": -473,
        "image": "assets/minimaps/AmbroseValley_Minimap.png",
    },
    "GrandRift": {
        "scale": 581,
        "originX": -290,
        "originZ": -290,
        "image": "assets/minimaps/GrandRift_Minimap.png",
    },
    "Lockdown": {
        "scale": 1000,
        "originX": -500,
        "originZ": -500,
        "image": "assets/minimaps/Lockdown_Minimap.jpg",
    },
}

IMAGE_SIZE = 1024
TRACK_EVENTS = {"Position", "BotPosition"}
KILL_EVENTS = {"Kill", "BotKill"}
DEATH_EVENTS = {"Killed", "BotKilled", "KilledByStorm"}
IMPORTANT_EVENTS = TRACK_EVENTS | KILL_EVENTS | DEATH_EVENTS | {"Loot"}


def is_bot(user_id: str) -> bool:
    return user_id.isdigit()


def decode_event(value) -> str:
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8")
    return str(value)


def world_to_pixel(map_id: str, x: float, z: float) -> tuple[float, float]:
    cfg = MAP_CONFIG[map_id]
    u = (x - cfg["originX"]) / cfg["scale"]
    v = (z - cfg["originZ"]) / cfg["scale"]
    return round(u * IMAGE_SIZE, 2), round((1 - v) * IMAGE_SIZE, 2)


def to_ms(value) -> int:
    if hasattr(value, "value"):
        return int(value.value // 1_000_000)
    return int(value.timestamp() * 1000)


def slugify_match_id(day_name: str, match_id: str) -> str:
    return f"{day_name}__{match_id.replace('.nakama-0', '')}"


def main() -> None:
    OUTPUT_ROOT.mkdir(exist_ok=True)
    matches_dir = OUTPUT_ROOT / "matches"
    matches_dir.mkdir(exist_ok=True)

    manifest_matches = []
    aggregate_points = []
    aggregate_counters = Counter()
    date_counters = Counter()
    map_counters = Counter()

    for day_dir in sorted(DATA_ROOT.iterdir()):
        if not day_dir.is_dir() or not day_dir.name.startswith("February_"):
            continue

        grouped_files = defaultdict(list)
        for file_path in sorted(day_dir.iterdir()):
            if file_path.is_file():
                parts = file_path.name.split("_", 1)
                if len(parts) == 2:
                    grouped_files[parts[1]].append(file_path)

        for match_id, file_paths in grouped_files.items():
            rows = []
            match_map = None
            player_types = {}
            unique_players = set()
            event_counts = Counter()
            match_min = None
            match_max = None

            for file_path in file_paths:
                table = pq.read_table(file_path)
                data = table.to_pydict()
                record_count = len(data["user_id"])

                for idx in range(record_count):
                    user_id = str(data["user_id"][idx])
                    map_id = str(data["map_id"][idx])
                    event = decode_event(data["event"][idx])
                    x = float(data["x"][idx])
                    z = float(data["z"][idx])
                    ts_raw = data["ts"][idx]
                    ts_value = ts_raw.to_pydatetime() if hasattr(ts_raw, "to_pydatetime") else ts_raw
                    ts_ms = to_ms(ts_value)

                    match_map = map_id
                    unique_players.add(user_id)
                    player_types[user_id] = "bot" if is_bot(user_id) else "human"
                    event_counts[event] += 1
                    match_min = ts_ms if match_min is None else min(match_min, ts_ms)
                    match_max = ts_ms if match_max is None else max(match_max, ts_ms)

                    px, py = world_to_pixel(map_id, x, z)
                    row = {
                        "userId": user_id,
                        "bot": player_types[user_id] == "bot",
                        "event": event,
                        "x": round(x, 2),
                        "z": round(z, 2),
                        "px": px,
                        "py": py,
                        "ts": ts_ms,
                    }
                    rows.append(row)

                    if event in IMPORTANT_EVENTS:
                        aggregate_points.append(
                            {
                                "matchId": match_id,
                                "date": day_dir.name,
                                "mapId": map_id,
                                "event": event,
                                "bot": row["bot"],
                                "px": px,
                                "py": py,
                            }
                        )
                        aggregate_counters[event] += 1
                        date_counters[day_dir.name] += 1
                        map_counters[map_id] += 1

            if not rows or match_map is None or match_min is None or match_max is None:
                continue

            rows.sort(key=lambda item: (item["ts"], item["userId"], item["event"]))
            for row in rows:
                row["offsetMs"] = row["ts"] - match_min

            humans = sum(1 for player in unique_players if not is_bot(player))
            bots = len(unique_players) - humans
            duration_ms = match_max - match_min

            manifest_matches.append(
                {
                    "id": match_id,
                    "slug": slugify_match_id(day_dir.name, match_id),
                    "date": day_dir.name,
                    "mapId": match_map,
                    "playerCount": len(unique_players),
                    "humanCount": humans,
                    "botCount": bots,
                    "durationMs": duration_ms,
                    "eventCounts": dict(event_counts),
                }
            )

            match_payload = {
                "id": match_id,
                "date": day_dir.name,
                "mapId": match_map,
                "durationMs": duration_ms,
                "startTs": match_min,
                "endTs": match_max,
                "players": [
                    {"userId": user_id, "bot": player_types[user_id] == "bot"}
                    for user_id in sorted(unique_players, key=lambda value: (is_bot(value), value))
                ],
                "events": rows,
            }

            output_path = matches_dir / f"{slugify_match_id(day_dir.name, match_id)}.json"
            with open(output_path, "w", encoding="utf-8") as fh:
                json.dump(match_payload, fh, separators=(",", ":"))

    manifest_matches.sort(key=lambda item: (item["date"], item["mapId"], item["id"]))
    aggregate_points.sort(key=lambda item: (item["date"], item["mapId"], item["matchId"], item["event"]))

    manifest = {
        "generatedAt": datetime.utcnow().isoformat() + "Z",
        "maps": MAP_CONFIG,
        "dates": sorted({match["date"] for match in manifest_matches}),
        "eventTypes": [
            "Position",
            "BotPosition",
            "Loot",
            "Kill",
            "Killed",
            "BotKill",
            "BotKilled",
            "KilledByStorm",
        ],
        "stats": {
            "matchCount": len(manifest_matches),
            "trackPointCount": sum(
                match["eventCounts"].get("Position", 0) + match["eventCounts"].get("BotPosition", 0)
                for match in manifest_matches
            ),
            "eventPointCount": sum(sum(match["eventCounts"].values()) for match in manifest_matches),
            "aggregateEventCounts": dict(aggregate_counters),
            "aggregateByDate": dict(date_counters),
            "aggregateByMap": dict(map_counters),
        },
        "matches": manifest_matches,
    }

    with open(OUTPUT_ROOT / "manifest.json", "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, separators=(",", ":"))

    with open(OUTPUT_ROOT / "aggregate-points.json", "w", encoding="utf-8") as fh:
        json.dump({"points": aggregate_points}, fh, separators=(",", ":"))


if __name__ == "__main__":
    main()
