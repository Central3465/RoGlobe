# Stage 2 — Architecture, limitations, permissions, plan

Decisions made with you after Stage 1:

- **Hybrid approach (option 1)**: a "Closest to me" mode that uses Roblox's own latency sort (no per-server probing), and a "Specific region" mode that checks a *capped* number of servers, only when you click.
- **Location by IP range**, using a small table bundled in the extension.
- **Plain JavaScript**, no build step, no runtime dependencies.

## 1. Where region data comes from

```
Roblox server list ──► server ids ──► join-ticket request (per server) ──► UdmuxEndpoints[0].Address (IP)
                                                                             │
                              bundled table src/shared/datacenters.js ◄──────┘
                              128.116.x.0/24 → city
                                                                             │
                                                         match? ── yes ──► "Frankfurt, DE"
                                                                 └ no ───► "Unknown location"
```

**Source of the IP table**: the community list
[Maneetbal/roblox-server-locations](https://github.com/Maneetbal/roblox-server-locations),
`robloxserveriplist.txt`, "Last updated: 2026-10-18". We bundle a reviewed **subset** of it:

- Only ranges inside `128.116.0.0/17`, which is registered to Roblox (AS22697, ROBLOX-PRODUCTION).
- Excluded: ranges marked `(AWS)` (that list itself says the label "does not independently confirm Roblox use"),
  ranges outside Roblox's own block, ranges marked "Not sure", and the "(Decommissioned?)" section.
- The list has no licence file. We copy only facts (IP range → city), not text, and credit the source.
  If its author objects, the table is easy to replace.

**How reliable is this?** Best effort, not guaranteed:

- The list's own README says locations are "estimates based on network observations, public routing data, and IP geolocation".
- Roblox staff have said on the DevForum that Roblox uses its IP ranges with several hosting companies, so IP data shouldn't be relied on for location.
- The address we read is the UDMUX (UDP proxy) endpoint in front of the game server, assumed to be in the same datacenter. **[assumption]**
- So RoGlobe labels matches as *approximate*, never shows a city for an IP it can't match, and puts the table in one auditable file.

## 2. Roblox endpoints used (and nothing else)

| Request | Why | Documented? |
|---|---|---|
| `GET https://games.roblox.com/v1/games/{placeId}/servers/Public?limit=100&excludeFullGames=true&cursor=` | list servers (region mode) | Legacy public API used by roblox.com; not Open Cloud |
| `GET https://games.roblox.com/v2/games/{placeId}/servers/Public?sortOrder=Desc&excludeFullGames=true&orderBy=BestLatency` | "Closest to me" | Undocumented, seen in RoValra. **[unverified live]** |
| `POST https://gamejoin.roblox.com/v1/join-game-instance` `{placeId, gameId, gameJoinAttemptId}` | read the server's IP | **Undocumented**, rate-limited. Requests a join ticket but does not launch the game |
| `Roblox.GameLauncher.joinGameInstance(placeId, gameId)` (page function) | join | Undocumented, but it's what Roblox's own Join button calls |

All requests are sent **from the content script on www.roblox.com**, so the browser attaches your Roblox
cookies exactly as when the website itself makes them. RoGlobe never reads, stores or forwards cookies or tokens.
POST requests need Roblox's anti-CSRF header: we take it from the page's `<meta name="csrf-token">`, or from
the `x-csrf-token` response header when Roblox returns 403 (Roblox's standard handshake), and keep it in memory only.

## 3. Permissions

```json
"permissions": ["storage"],
"content_scripts": [{ "matches": ["https://www.roblox.com/games/*", "https://www.roblox.com/*/games/*"] }]
```

- `storage`: save your selected region and mode locally (`chrome.storage.local`).
- No `host_permissions`. Content-script requests to `games.roblox.com` and `gamejoin.roblox.com` are allowed by
  Roblox's own CORS policy for `www.roblox.com`, the same way the website makes them. Chrome docs: content-script requests follow the page's CORS rules. RoValra makes the same calls from its content script. **[to be confirmed on the live site by you]**
- No `scripting`, `tabs`, `webRequest`, `declarativeNetRequest`, background service worker or remote code.
- Joining uses a second, static content script that runs in the page's JavaScript world (`"world": "MAIN"`).
  It only listens for one message and calls Roblox's own join function, after validating that the place id is
  a number and the server id is a UUID. No strings are ever turned into code. Pages could send that message
  themselves, but they can already call Roblox's join function directly, so this grants nothing new.

## 4. Safety limits on probing

- Nothing is probed until you click **Find servers**.
- One request at a time, ≥ 250 ms apart.
- Stops at the first of: 10 matching servers, 100 servers checked, end of the list, or the first **HTTP 429**
  (rate limit). On 429 we tell you to wait and never retry automatically.
- Results are cached in memory for the open tab only.

## 5. File structure

```
manifest.json
src/
  shared/
    ip.js            IPv4 parsing + CIDR matching (pure, unit-tested)
    datacenters.js   the bundled IP-range table + credit
    regions.js       region list, lookup IP → region, display names (pure, unit-tested)
    settings.js      chrome.storage.local wrapper with validation
  content/
    roblox-api.js    the only file that makes network requests (list servers, join ticket, CSRF)
    finder.js        pagination + probing + filtering with caps / 429 / errors (unit-tested with fake API)
    panel.js         the on-page RoGlobe panel (UI, states, keyboard)
    main.js          finds the server list on the page and mounts the panel
    launcher-main.js MAIN-world join bridge
    panel.css
  popup/
    popup.html / popup.js / popup.css   region picker + current selection
icons/               16/48/128 PNG (original artwork)
tests/               node --test unit tests + static security checks
docs/
```

Files are classic scripts that share one `globalThis.RoGlobe` namespace, because MV3 content scripts can't
use ES-module `import`. Each pure module also exports for Node so tests run with `node --test` and zero dependencies.

## 6. What happens when filtering is off

The panel collapses to a one-line bar ("Region filter off"). No requests are made, and Roblox's own
server list is untouched. RoGlobe never hides or rewrites Roblox's list; results appear in RoGlobe's own panel.

## 7. Known unknowns (need your browser to confirm)

- Current Roblox server-list DOM ids (we try several known selectors and fall back to the top of the page).
- Whether `join-game-instance` still returns `UdmuxEndpoints` for your account, and whether it answers with JSON or
  a `text/event-stream` (RoValra handles both; so do we).
- Whether the latency ordering parameter is still accepted.
