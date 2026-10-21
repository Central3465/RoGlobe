# Stage 1 — How RoValra's region feature works

Reference: `NotValra/RoValra` @ `main`, shallow clone inspected on 2026-10-21.
Nothing here is copied into RoGlobe; this is notes for an independent implementation.

Legend: **[verified]** = read in the source. **[assumption]** = inferred, not tested.
Live Roblox requests could **not** be tested: the build container's network policy blocks `*.roblox.com`.

## 0. This repository

- Contains only `README.md` and `LICENSE` (GPL-3.0). No extension code yet. **[verified]**
- RoValra is also GPL-3.0, *except* its logo/icons/branding, which are not licensed for reuse. **[verified: RoValra `LICENSE` header]**
  Since this repo is GPL-3.0 too, small borrowed snippets would be legally compatible, but we will write our own code and use none of their assets or name.

## 1. Platform

RoValra is a Chrome MV3 extension built with a JS bundler (`build.js`). **[verified]**

| Manifest field | RoValra | Region feature actually needs |
|---|---|---|
| `content_scripts.matches` | `*://*.roblox.com/*` (3 scripts, two in `MAIN` world at `document_start`) | `https://www.roblox.com/*games/*` only |
| `permissions` | `declarativeNetRequest`, `storage`, `scripting` (+ optional `webRequest`, `webNavigation`, …) | `storage` (+ `scripting` only for the launch step, see §6) |
| `host_permissions` | `*://*.roblox.com/*` and others | `games.roblox.com`, `gamejoin.roblox.com` |

## 2. The pieces of the region feature

| File | Role |
|---|---|
| `src/content/core/regions.js` | Downloads the **datacenter list**, builds `datacenterId → location` map and region codes (`US-CA-LOSANGELES`, `DE-FRANKFURT`, …), display names, continent table |
| `src/content/core/apis/serverApi.js` | `fetchServerRegion()` – asks Roblox for a join ticket for one server and reads `joinScript.DataCenterId`; `fetchServerDetails()` – asks **RoValra's API** for location/uptime |
| `src/content/core/games/servers/filters/regionfilters.js` | Region filter dropdown + 3-D globe on the server list; server counts and per-region server lists from **RoValra's API**; fallback "independent scan" using Roblox only |
| `src/content/core/preferredregion.js`, `regionFinder/ClosestServer.js`, `features/games/RegionPlayButton.js` | "Play in preferred region" button: finds the nearest/selected region, picks a server, launches it |
| `src/content/core/utils/location.js` | Estimates the **user's** location (see §5) |
| `src/content/core/utils/launcher.js` + `background/background.js` (`injectScript`) | Starts the Roblox client |

## 3. Where region data comes from (the key finding)

Roblox's public server list (`GET games.roblox.com/v1/games/{placeId}/servers/Public`) returns
`id, maxPlayers, playing, fps, ping, playerTokens` — **no location**. **[verified by the fields RoValra reads; matches Roblox's own server-list page]**

RoValra gets location two ways:

1. **RoValra's own backend (third-party).** `www.rovalra.com` / `apis.rovalra.com` endpoints: **[verified]**
   - `/v1/datacenters/list` → `[{ dataCenterIds: [..], location: { city, region, country, latLong } }]`
   - `/v1/servers/counts?place_id=` → server counts per region
   - `/v1/servers/region?place_id=&country=&city=&cursor=` → servers already located by RoValra's crawler
   - `/v1/servers/details?place_id=&server_ids=` → city/country/IP/uptime per server
   - `/geolocation/{lat}.json` → country for the user's coordinates

   These are private, undocumented and outside our control. Using them would violate RoGlobe's privacy goal (they'd see every place you browse).

2. **Roblox's join endpoint, one call per server.** `POST gamejoin.roblox.com/v2/join-game-instance`
   with `{ placeId, gameId: <serverId>, gameJoinAttemptId: <uuid> }`, sent with the user's Roblox cookies. **[verified]**
   The response's `joinScript` contains `DataCenterId` (a number) and `UdmuxEndpoints[0].Address` / `MachineAddress` (server IP).
   The `DataCenterId` is then looked up in the datacenter list from (1).

So even RoValra's "Roblox-only" fallback still depends on RoValra's datacenter list to turn an ID into a city.

## 4. Selection, persistence, filtering, pagination

- **Region IDs** are built from location: `US-<STATE>-<CITY>` for the US, `<COUNTRY>-<CITY>` elsewhere, plus `AUTO`. **[verified]**
- **Selection UI**: dropdown + globe injected above the server list; a separate globe button next to Play. **[verified]**
- **Persistence**: `chrome.storage.local` (preferred-region key, cached region list, cached datacenter list with 10-min refresh). Invalid saved region is reset to `AUTO`. **[verified]**
- **Filtering**: with RoValra's API, the API returns already-filtered servers with its own `next_cursor`. Fallback scan pages Roblox's list (`limit=100`, follows `nextPageCursor`) and calls `join-game-instance` for **every** server with a 100 ms pause, grouping by region. **[verified]** No 429/back-off handling in the scan; errors stop it silently. **[verified]**
- **Joining**: `Roblox.GameLauncher.joinGameInstance(placeId, serverId)` — Roblox's own page function — executed in the page via `chrome.scripting.executeScript({ world: 'MAIN' })` which inserts a `<script>` built from a string. **[verified]**

## 5. Other behaviours worth knowing

- **User location** is taken from `joinScript.SessionId`, which Roblox fills with the user's latitude/longitude. Coordinates are then sent (rounded) to RoValra's server for country lookup. **[verified]** We don't need this: the user just picks a region.
- **Roblox's own latency sort**: `GET games.roblox.com/v2/.../servers/Public?orderBy=BestLatency` exists and RoValra uses it for "Automatic". **[verified in source; undocumented]**

## 6. Documented vs undocumented

| Behaviour | Status |
|---|---|
| Public server list `games.roblox.com/v1/games/{id}/servers/Public` | Used by roblox.com itself; listed on Roblox's legacy API docs page; not part of Open Cloud. Stable in practice. **[assumption on stability]** |
| `gamejoin.roblox.com/v2/join-game-instance` to read `DataCenterId` | **Undocumented**, internal to the Roblox client. Requests a real join ticket. Rate-limited. Response fields can change without notice. |
| `DataCenterId → city` mapping | **Not published by Roblox.** Only third-party, community-maintained lists exist. |
| `Roblox.GameLauncher.joinGameInstance` | Undocumented page function, but it *is* the normal Roblox join path (same as the website's Join button). |
| RoValra endpoints | Third-party, private. **Excluded.** |

## 7. Limitations that affect the design

1. **No official location data.** Every working region filter (RoValra included) relies on
   (a) an undocumented join-ticket call per server, and (b) a datacenter→city table that Roblox doesn't publish.
2. **Volume.** Locating N servers costs N authenticated join-ticket requests. Popular games have thousands of servers. Roblox rate-limits this (429) and it looks like automated join spam. We must cap it (e.g. one page of 100, with delay and back-off) and stop on 429.
3. **ToS grey area.** Probing join tickets in bulk is not something Roblox documents or endorses. It doesn't bypass auth (it uses your own session for something the client does anyway), but heavy use could trigger anti-abuse. Users should know this.
4. **Mapping freshness.** A bundled table goes stale when Roblox adds/renumbers datacenters. Unknown IDs must show as "Unknown location", never guessed.
5. **Joining from an extension** requires running a call in the page's JS world. Clean MV3 options: a static file injected with `chrome.scripting.executeScript({ files, world: 'MAIN' })`, or a static `world: "MAIN"` content script listening for a message. Either way, no string-built code.
6. **I cannot test against live Roblox** from this environment. Final verification must happen in your browser.
