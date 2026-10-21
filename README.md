# RoGlobe

**Your Roblox. Your region.** Lightweight · Open-source · Privacy-first

RoGlobe is a small Chrome/Edge extension (Manifest V3) that helps you find Roblox servers in a region you choose.
It adds one panel above the server list on Roblox game pages, plus a toolbar popup.

- **Off**: Roblox works exactly as normal. No requests are made.
- **Closest to me**: one request using Roblox's own latency sort. No per-server lookups.
- **Pick a region**: when you click **Find servers**, RoGlobe checks up to 100 servers, one at a time, and shows the ones
  whose IP falls in that region's known ranges. Click **Join** to join through Roblox's normal launcher.

Not affiliated with Roblox Corporation.

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

## Install (unpacked)

Unfortunately and being fully transparent, this extension won't realistically perform well, hence the $5 fee for Chrome Developer Web Store is not justifiable, however I may revisit this in the future including Microsoft Edge and Firefox. In the meantime, you would have to download git, clone the repository and then unpack it in the extensions page with developer mode toggled on. To make this easier for you, I do plan on creating a one-click installer release zip file soon. 

1. Download or clone this repository.
2. **Chrome:** open `chrome://extensions` · **Edge:** open `edge://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the repository folder (the one containing `manifest.json`).
5. Pin RoGlobe from the puzzle-piece menu if you want the popup handy.

Requires Chrome/Edge 116 or newer.

## Development

No build step and no dependencies. required.

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

GPL-3.0 (see `LICENSE`).