# Security & privacy self-review — RoGlobe 0.1.0

**What this is:** a line-by-line review of RoGlobe's own source by its author (with Claude Code), backed by
automated checks in `tests/security.test.js`. **What it is not:** an independent security audit or penetration test.
RoGlobe has not been tested against the live Roblox website by the author; see "Not verified" below.

## Inventory of shipped code

| File | Runs in | Network | Storage | Notes |
|---|---|---|---|---|
| `src/shared/ip.js`, `datacenters.js`, `regions.js` | content script + popup | – | – | Pure data/functions |
| `src/shared/settings.js` | content script + popup | – | `chrome.storage.local` | Stores only `{ mode, regionId }`, validated on read |
| `src/content/roblox-api.js` | content script (isolated world) | **yes** | – | Only file allowed to make requests; hard allow-list of 2 hosts |
| `src/content/finder.js` | content script | via api | – | Caps, pacing, stop on 429 |
| `src/content/panel.js`, `main.js` | content script | – | – | DOM built with `textContent`/`createElement` only |
| `src/content/launcher-main.js` | **page world** | – | – | Calls `Roblox.GameLauncher.joinGameInstance` after validating ids |
| `src/popup/*` | extension popup | – (CSP `connect-src 'none'`) | via settings.js | No inline scripts |

## Checklist

| Concern | Result | Evidence |
|---|---|---|
| Permissions | `storage` only. No host permissions, no `scripting`, `tabs`, `cookies`, `webRequest`, background worker. | `manifest.json`; test `manifest: MV3, only the storage permission…` |
| Where it runs | `https://www.roblox.com/games/*` and `https://www.roblox.com/*/games/*`, top frame only | test `content scripts only on www.roblox.com game pages` |
| Network destinations | `games.roblox.com`, `gamejoin.roblox.com` only, HTTPS only; enforced in code (`ALLOWED_HOSTS`) and by tests; browser e2e check observed no other host | `roblox-api.js`; tests; `tests/e2e/browser-check.js` |
| Credentials | Never read, stored, logged or sent anywhere else. Cookies are attached by the browser to Roblox's own hosts (`credentials: 'include'`). The Roblox anti-CSRF token is read from the page or a 403 response header and kept **in memory only**. | `roblox-api.js`; test `no credential handling` |
| Join-ticket contents | Only the server IP is read; the rest of the response is discarded, never stored or displayed | `extractServerAddress` |
| Remote code / eval | None. No `eval`, `new Function`, string timers, dynamic `import`, `chrome.scripting`, remote `<script>` | test `no dynamic code execution…`; popup CSP `script-src 'self'` |
| HTML injection | No `innerHTML`/`insertAdjacentHTML`/`document.write`. API data only ever reaches `textContent` | test; `panel.js` |
| Page-world bridge | Accepts one message type from the same window/origin, validates numeric place id and UUID server id, calls Roblox's own function. A hostile page script could trigger it, but could equally call Roblox's function itself, so no new capability | `launcher-main.js` |
| Message spoofing (page → content script) | A page could forge a `join-result` message; worst case the panel shows the wrong join status text | `main.js` |
| Storage | Local only, no `sync`. Values sanitised on load (unknown region → null, unknown mode → off) | `settings.js`; `tests/settings.test.js` |
| Telemetry / analytics / ads | None | grep + host allow-list test |
| Dependencies | Zero runtime and zero dev dependencies (`package.json`) | test `no runtime dependencies` |
| Anti-abuse respect | Lookups only on click; ≤ 100 per click; one at a time, ≥ 250 ms apart; stop on first 429 with no automatic retry; 3 consecutive failures stop the run | `finder.js`; `tests/finder.test.js` |

## Residual risks and honest caveats

1. **Undocumented Roblox endpoints.** `gamejoin.roblox.com/v1/join-game-instance` and the `orderBy=BestLatency`
   parameter are not documented. Roblox may change or block them; RoGlobe then shows an error, it does not work around it.
2. **Join-ticket requests are real requests on your account.** They don't start the game, but Roblox sees them.
   Heavy use could plausibly trigger Roblox's anti-abuse systems. The caps above are a guess at "polite", not a guarantee.
3. **Location accuracy.** The IP table is community data (see `src/shared/datacenters.js`). Roblox staff have said IP
   ranges are not a reliable location signal. Labels say "approx." and unmatched servers are "unknown".
4. **DOM coupling.** Roblox can rename the server-list container; RoGlobe then falls back to the top of the Servers tab
   or page content. It never hides or modifies Roblox's own list.
5. **Supply chain of this repo.** Anyone with push access can change the code. Review diffs before updating your unpacked copy.

## Not verified

- Behaviour on the live roblox.com site (this environment cannot reach Roblox). All browser testing used a mocked page
  and mocked API responses that follow the shapes RoValra's source expects.
- Microsoft Edge (expected to match Chromium; not run).
