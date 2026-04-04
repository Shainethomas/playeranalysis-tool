# Insights

## 1. Ambrose Valley dominates player attention

What stood out:
The dataset is heavily concentrated in Ambrose Valley, which accounts for 61,013 tracked rows versus 21,238 for Lockdown and 6,853 for Grand Rift.

Evidence:
This split came directly from the preprocessing pass over all 89,104 event rows.

Actionable takeaway:
If a level designer is prioritizing fixes or content investment, Ambrose Valley should receive first attention because improvements there will affect the largest share of observed player behavior. The primary metrics affected would be session quality, engagement with traversal spaces, and combat encounter pacing on the most-played map.

Why a level designer should care:
High-traffic maps amplify both good and bad layout decisions. Any chokepoint, dead zone, or loot-path imbalance on Ambrose Valley will affect far more players than the same issue on the other maps.

## 2. The telemetry is strongly movement and loot oriented

What stood out:
Movement and loot dominate the event stream: `Position` + `BotPosition` total 73,059 rows, and `Loot` adds 12,885 more. Direct player-vs-player kill markers are rare in comparison.

Evidence:
Aggregate event counts:
- Position: 51,347
- BotPosition: 21,712
- Loot: 12,885
- BotKill: 2,415
- BotKilled: 700
- Kill: 3
- Killed: 3
- KilledByStorm: 39

Actionable takeaway:
The strongest map-design signal in this slice is route choice, not just final combat outcomes. Level designers should use the traffic and loot heatmaps to judge whether the intended flow is actually happening. The metrics likely affected are loot engagement, path diversity, encounter rate, and extraction-route usage.

Why a level designer should care:
If players are not traveling through intended spaces, combat balance changes alone will not solve the underlying map problem.

## 3. Storm deaths exist, but they are niche compared to bot combat

What stood out:
There are only 39 storm deaths in the full sample, while bot-related combat events are much more common.

Evidence:
`KilledByStorm` appears 39 times across all five days, compared with 2,415 `BotKill` events and 700 `BotKilled` events.

Actionable takeaway:
The current storm pressure looks like a situational finisher rather than the dominant source of failure in this dataset. If the design goal is to make the moving storm reshape routes more aggressively, designers should track storm-death share, late-match path compression, and extraction completion under storm pressure after any tuning pass.

Why a level designer should care:
Storm tuning changes how urgently players rotate and which parts of the map become meaningful late in the match.
