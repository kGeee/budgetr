# budgetr — desktop (macOS + Windows)

budgetr is a server-backed app (SQLite, Plaid, live prices), so a desktop window
needs a running server behind it. The supported product path is the **Electron
app** — a self-contained installer that starts its own server and shows a native
window. Non-developers should download a Release artifact, not clone this repo.

- **macOS:** `budgetr-mac.dmg` from [GitHub Releases](https://github.com/kGeee/budgetr/releases/latest)
- **Windows:** `budgetr-win.exe` (per-user NSIS, x64) from the same Releases page

There is also a lightweight **LaunchAgent + PWA** path on macOS only — see
[the bottom of this file](#alternative-launchagent--pwa).

---

# Electron app

A thin [Electron](https://www.electronjs.org/) shell around the existing Next.js
app. It runs the **same web build** locally — `next start` as a child process —
and points a native window at it (on a free local port it picks automatically, so
it never collides with whatever's already on :3000). There is no second
codebase: the desktop app is the web app, packaged for the Dock / Start Menu.

```
desktop/electron/
  main.js        # main process: spawns the server, opens the window
  preload.js     # narrow IPC bridge (privacy gate, open data folder, quit)
  loading.html   # dark splash shown while the server warms up
desktop/scripts/
  make-icns.sh   # builds build/icon.icns from public/icons/icon-512.png (macOS)
  make-ico.mjs   # builds build/icon.ico from the PWA icons (Windows CI + local)
desktop/build/   # generated icons (git-ignored)
```

## Build your own package

From the `web/` directory:

```bash
npm install
npm run package:mac   # → dist/budgetr-mac.dmg (+ zip)
npm run package:win   # → dist/budgetr-win.exe (NSIS, x64, per-user)
```

`npm run package` is an alias for `package:mac` (keeps existing muscle memory).

### Windows notes

- Target is **NSIS x64**, per-user install (`allowElevation: false`) — no admin/UAC.
- Receipt OCR (Swift helper) is **Mac-only** and is not bundled on Windows.
- First launch shows a hard privacy / permissions / data-folder gate before the
  dashboard. Completion is stored as `privacy-gate-done` under
  `%APPDATA%\budgetr\` (Electron `userData`).
- Optional Authenticode: set the same `CSC_LINK` / `CSC_KEY_PASSWORD` secrets
  used for Mac. **Unsigned first artifacts are fine** — without those secrets
  the installer still builds; Windows SmartScreen will warn on first launch
  (More info → Run anyway). Do not invent or commit a cert.

### macOS notes

> First launch of an unsigned/ad-hoc build is blocked by Gatekeeper. Right-click
> the app → **Open** → **Open**, once. Signed+notarized Release builds open with
> a normal double-click.

## Develop against the shell

```bash
npm run dev:electron
```

Opens Electron pointed at `next dev` with hot reload, on an auto-picked free port.
Pin a specific port with `PORT=3010 npm run dev:electron`. To attach the shell to
a server you're already running yourself, set
`ELECTRON_START_URL=http://localhost:3000`. The spawned server's output is written
to `server.log` in the app's user-data dir for debugging.

The Windows privacy gate is **not** forced in `dev:electron` / `npm run dev` /
`start.bat` — only packaged Windows builds set `BUDGETR_DESKTOP=1`.

## How it fits together

- **Server**: `main.js` spawns Next using Electron's bundled Node
  (`ELECTRON_RUN_AS_NODE`), polls the port until it answers, then loads the URL.
  On quit, the server process is killed.
- **Database**: in a packaged app the bundle is read-only, so the SQLite file is
  relocated to the per-user data directory
  (`~/Library/Application Support/budgetr/` on macOS, `%APPDATA%\budgetr\` on
  Windows) and **migrations run on launch**. In `dev:electron` it uses the
  project's usual `./data/budgetr.db`.
- **Secrets / config**: a publicly distributed build must **not** bake secrets
  into the bundle. Packaged apps create `<userData>/budgetr.env` on first launch
  with a generated `APP_ENCRYPTION_KEY` and empty Plaid/Finnhub placeholders.
- **Window chrome**: macOS uses a frameless `hiddenInset` title bar; Windows uses
  a native frame (min/max/close + drag) so the window never looks broken.

## The two gotchas

**1. Native module ABI (`better-sqlite3`).** It has compiled bindings that must
match the runtime. The web app runs on **system Node**; Electron uses **its
own**. They can't both be satisfied in one `node_modules` at once, so:

| You want to… | Run |
| --- | --- |
| Build/run the desktop app | `npm run package:mac` / `package:win` / `dev:electron` (rebuilds for Electron automatically) |
| Go back to web dev (`npm run dev`) | `npm run web:rebuild` |

If `npm run dev` ever crashes with a `better-sqlite3`/`NODE_MODULE_VERSION`
error, you most recently did desktop work — run `npm run web:rebuild`.

**2. Bundle size.** The packaged app includes a full `node_modules`
(~300 MB+). That's normal for Electron and fine for distribution; it just
isn't a small download. (This is the main reason the LaunchAgent + PWA path below
still exists on macOS.)

## Pinned versions — don't bump blindly

- **`electron-builder` is pinned to `25.x`.** v26 rewrote its dependency
  collector and mis-packages `better-sqlite3` (the one native module shared by
  the app and `drizzle-orm`), failing with `ensureSymlink ENOENT … better-sqlite3`.
  25.1.8 packages it correctly. Revisit only once that regression is fixed upstream.
- **`better-sqlite3` is `^12.11.1`.** 12.10 won't compile against Electron 42's
  V8 14.8; 12.11.1 does.
- **The packaged build uses `next build --webpack`, not Turbopack.** Turbopack
  resolves `serverExternalPackages` (i.e. `better-sqlite3`) through a
  build-machine symlink at `.next/node_modules/<hashed-name>` that points back to
  the source `node_modules` — it neither copies into the `.app` nor resolves on
  another machine, so the packaged server crashed with `Cannot find module
  'better-sqlite3-<hash>'`. The webpack build emits a plain `require("better-sqlite3")`
  that resolves from the bundled `node_modules`. (The normal `build` script stays
  on Turbopack — this only affects packaging.)

## Distribution

Release tags (`v*`) run `.github/workflows/release.yml`:

- **macOS** job → `budgetr-mac.dmg` / zip + `latest-mac.yml`
- **Windows** job → `budgetr-win.exe` + `latest.yml` (when produced)

Optional signing via `CSC_LINK` / `CSC_KEY_PASSWORD`. Without those secrets both
platforms still build; macOS is ad-hoc signed, Windows is unsigned (SmartScreen).

---

# Alternative: LaunchAgent + PWA

No Electron, no 300 MB bundle — keep the server alive with a macOS LaunchAgent
and install the page as a PWA from your browser. (macOS only.)

## 1. Build + start the always-on server

```bash
cd web
npm run build
./desktop/install.sh      # writes ~/Library/LaunchAgents/dev.budgetr.server.plist and loads it
```

`install.sh` runs `next start` on port 3000, starts it at login, and restarts it
if it crashes. Logs: `/tmp/budgetr-server.out.log`, `/tmp/budgetr-server.err.log`.
Re-run `install.sh` after pulling new code (rebuild first with `npm run build`).

## 2. Add it to the Dock

**Chrome / Edge** → open `http://localhost:3000`, then ⋮ → **Cast, save, and
share → Install page as app**. It lands in `/Applications` and the Dock;
right-click the Dock icon → **Keep in Dock**.

**Safari 17+** → open `http://localhost:3000`, then **File → Add to Dock**.

## Managing the server

```bash
./desktop/uninstall.sh                                  # stop + remove the agent
launchctl bootout  gui/$(id -u)/dev.budgetr.server      # stop now
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.budgetr.server.plist  # start now
```

The agent owns port 3000. To run `next dev` alongside it, stop the agent or use
another port (`next dev -p 3001`). Custom port for the agent:
`PORT=4000 ./desktop/install.sh` (then install the PWA from that origin).
