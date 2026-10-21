# RoGlobe

**Your Roblox. Your region.** Lightweight · Open-source · Privacy-first

RoGlobe is a small Chrome/Edge extension (Manifest V3) that helps you find Roblox servers in a region you choose.
It adds one panel above the server list on Roblox game pages, plus a toolbar popup.

- **Off**: Roblox works exactly as normal. No requests are made.
- **Closest to me**: one request using Roblox's own latency sort. No per-server lookups.
- **Pick a region**: when you click **Find servers**, RoGlobe checks up to 100 servers, one at a time, and shows the ones
  whose IP falls in that region's known ranges. Click **Join** to join through Roblox's normal launcher.

Not affiliated with Roblox Corporation or with RoValra.

## How location is determined (and how reliable it is)

Roblox's server list contains no location. For each server, RoGlobe asks Roblox for a join ticket
(the same request the Roblox client makes, but without launching the game) and reads the server's IP address.
That IP is matched against a bundled table of Roblox IP ranges → cities (`src/shared/datacenters.js`), taken from the
community list [Maneetbal/roblox-server-locations](https://github.com/Maneetbal/roblox-server-locations).

This is **approximate**: the data is community observation, not published by Roblox, and Roblox can change it.
Servers whose IP isn't in the table are shown as **unknown**, never guessed.

## Privacy

- No analytics, telemetry, ads, accounts or external servers.
- Network requests go only to `games.roblox.com` and `gamejoin.roblox.com`.
- Cookies/tokens are never read or stored by RoGlobe. Settings (`mode`, `regionId`) stay in `chrome.storage.local`.
- Permissions: `storage` only. Runs only on `https://www.roblox.com/games/…` pages.

Details: [docs/security-review.md](docs/security-review.md) (a self-review, **not** an independent audit).

## Install (unpacked)

1. Download or clone this repository.
2. **Chrome:** open `chrome://extensions` · **Edge:** open `edge://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the repository folder (the one containing `manifest.json`).
5. Pin RoGlobe from the puzzle-piece menu if you want the popup handy.

Requires Chrome/Edge 116 or newer.

### Inspect what it can do

- On the extensions page, click **Details** on RoGlobe. "Site access" should list only `www.roblox.com`
  and there should be no other permissions besides storage (Chrome may not show storage at all, since it needs no warning).
- Read `manifest.json`. It's 50 lines.
- **Network check:** open a Roblox game page, press F12 → **Network**, use RoGlobe, and confirm requests only go to
  `games.roblox.com` and `gamejoin.roblox.com`.
- **Storage check:** open the RoGlobe popup, right-click inside it → **Inspect**, then in the DevTools
  console run `chrome.storage.local.get(null).then(console.log)`. You should see only `roglobeSettings`.

## Manual test checklist (live Roblox)

These couldn't be run by the author's environment. Please try them and report what you see:

- [ ] Panel appears above "Servers" on a game page (e.g. `https://www.roblox.com/games/<id>`), and looks right in light and dark theme.
- [ ] **Off**: no requests appear in DevTools → Network when you load the page.
- [ ] **Closest to me** lists servers. If it shows an error, Roblox may no longer support the latency sort.
- [ ] **Pick a region → Find servers**: the status counts climb; servers in that region appear with **Join**.
      If every server is "unknown", the join response or IP table has likely changed (please report the region).
- [ ] **Join** opens Roblox's usual launch dialog for that server.
- [ ] Your choice is remembered after reloading the page and in the popup.
- [ ] Signed out of Roblox: you get a "Sign in to Roblox" message, not a crash.

## Development

No build step and no dependencies. The files you load are the files you read.

```
npm test                       # unit + static security tests (Node 22+, built-in test runner)
NODE_PATH="$(npm root -g)" node tests/e2e/browser-check.js   # optional: real Chromium + mocked Roblox; needs a global `npm i -g playwright`
python3 scripts/make-icons.py  # regenerate icons (needs Pillow)
```

Layout:

```
manifest.json
src/shared/   ip.js · datacenters.js (IP table) · regions.js · settings.js
src/content/  roblox-api.js (all network code) · finder.js (filtering) · panel.js + panel.css (UI) · main.js · launcher-main.js (join bridge)
src/popup/    popup.html · popup.js · popup.css
tests/        *.test.js, helpers/fake-roblox.js, e2e/browser-check.js
docs/         stage-1-investigation.md · stage-2-architecture.md · security-review.md
```

To update the IP table, edit `src/shared/datacenters.js` and run `npm test` (it checks format, that ranges are
inside Roblox's `128.116.0.0/17` block, and that none overlap).

## Licence

GPL-3.0 (see `LICENSE`). The design was informed by reading RoValra (GPL-3.0), but no RoValra code, assets or services are used.
