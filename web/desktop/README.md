# budgetr — desktop (macOS)

budgetr is a server-backed app (SQLite, Plaid, live prices), so a desktop window
needs a running server behind it. There are two ways to get budgetr in your Dock;
pick one.

- **Electron app** (recommended) — a self-contained `budgetr.app` that starts its
  own server and shows a native window. One build, drag to Applications, done.
- **LaunchAgent + PWA** (lightweight) — keep `next start` alive with a macOS
  LaunchAgent and install the page as a browser PWA. No Electron, much smaller,
  but relies on your browser. See [the bottom of this file](#alternative-launchagent--pwa).

---

# Electron app

A thin [Electron](https://www.electronjs.org/) shell around the existing Next.js
app. It runs the **same web build** locally — `next start` as a child process —
and points a native window at it (on a free local port it picks automatically, so
it never collides with whatever's already on :3000). There is no second
codebase: the desktop app is the web app, packaged for the Dock.

```
desktop/electron/
  main.js        # main process: spawns the server, opens the window
  loading.html   # dark splash shown while the server warms up
desktop/scripts/
  make-icns.sh   # builds build/icon.icns from public/icons/icon-512.png
desktop/build/   # generated icon (git-ignored)
```

## Build your own `.app`

From the `web/` directory:

```bash
npm install
npm run package
```

This produces, in `web/dist/`:

- `budgetr.app` — the application bundle
- `budgetr-mac.dmg` — a drag-to-Applications installer

Then drag **budgetr.app** to `/Applications` (or open the `.dmg` and do the same).

> First launch is unsigned, so macOS Gatekeeper will block it. Right-click the
> app → **Open** → **Open**, once. (See "Distribution" below for why.)

## Develop against the shell

```bash
npm run dev:electron
```

Opens Electron pointed at `next dev` with hot reload, on an auto-picked free port.
Pin a specific port with `PORT=3010 npm run dev:electron`. To attach the shell to
a server you're already running yourself, set
`ELECTRON_START_URL=http://localhost:3000`. The spawned server's output is written
to `server.log` in the app's user-data dir for debugging.

## How it fits together

- **Server**: `main.js` spawns Next using Electron's bundled Node
  (`ELECTRON_RUN_AS_NODE`), polls the port until it answers, then loads the URL.
  On quit, the server process is killed.
- **Database**: in a packaged app the bundle is read-only, so the SQLite file is
  relocated to the per-user data directory
  (`~/Library/Application Support/budgetr/budgetr.db`) and **migrations run on
  launch**. In `dev:electron` it uses the project's usual `./data/budgetr.db`.
- **Secrets / config**: the packaged app bundles your local `.env` and
  `.env.local` (Plaid, Finnhub, the encryption key). Each person builds with
  their own credentials.

## The two gotchas

**1. Native module ABI (`better-sqlite3`).** It has compiled bindings that must
match the runtime. The web app runs on **system Node**; Electron uses **its
own**. They can't both be satisfied in one `node_modules` at once, so:

| You want to… | Run |
| --- | --- |
| Build/run the desktop app | `npm run package` / `npm run dev:electron` (rebuilds for Electron automatically) |
| Go back to web dev (`npm run dev`) | `npm run web:rebuild` |

If `npm run dev` ever crashes with a `better-sqlite3`/`NODE_MODULE_VERSION`
error, you most recently did desktop work — run `npm run web:rebuild`.

**2. Bundle size.** The packaged `.app` includes a full `node_modules`
(~300 MB+). That's normal for Electron and fine for "build your own"; it just
isn't a small download. (This is the main reason the LaunchAgent + PWA path below
still exists.)

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

For **"share the source, build your own"** (the supported path) you need nothing
beyond the above.

To hand someone a **prebuilt binary** that opens without the Gatekeeper prompt,
you'd sign and notarize it with an Apple Developer ID certificate — out of scope
here. Also note: a built `.app` contains the `.env`/`.env.local` you built it
with, i.e. **your secrets**. Don't redistribute your own build.

---

# Alternative: LaunchAgent + PWA

No Electron, no 300 MB bundle — keep the server alive with a macOS LaunchAgent
and install the page as a PWA from your browser.

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
