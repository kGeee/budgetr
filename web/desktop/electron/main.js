// Electron main process for the budgetr desktop app.
//
// The desktop app is a thin native shell around the existing Next.js server: we
// spawn `next start` (production) or `next dev` (development) as a child process,
// wait for it to answer on localhost, then point a BrowserWindow at it. There is
// no second copy of the app — the same web build runs locally.
//
// Two things make the packaged app behave: (1) the SQLite database lives in a
// writable per-user directory rather than the read-only app bundle, and (2)
// migrations run on launch so a fresh install comes up with the right schema.

const { app, BrowserWindow, dialog, shell, Menu, nativeTheme, session } = require("electron");
const path = require("node:path");
const net = require("node:net");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const HOST = "127.0.0.1";
// Allow pointing the shell at an already-running server (e.g. your own
// `next dev`) instead of having Electron spawn one.
const EXTERNAL_URL = process.env.ELECTRON_START_URL || null;

// In a packaged build (asar:false) getAppPath() is <bundle>/Contents/Resources/app;
// in development (run via the electron CLI) it's the web/ project root, two levels
// up from this file.
const appPath = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, "..", "..");

let serverProcess = null;
let mainWindow = null;
let quitting = false;
// Resolved during boot — the URL the window points at.
let serverUrl = EXTERNAL_URL;

/**
 * Pick a port to run the server on. An explicit PORT env wins; otherwise we ask
 * the OS for a free ephemeral port so the app never collides with whatever else
 * is already on :3000 (a dev server, another app, …).
 */
function choosePort() {
  const explicit = Number(process.env.PORT);
  if (explicit) return Promise.resolve(explicit);
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once("error", reject);
    srv.listen(0, HOST, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Where the child server streams its stdout/stderr, for diagnosing failures. */
function serverLogPath() {
  return path.join(app.getPath("userData"), "server.log");
}

/** Per-user, writable location for the SQLite database (survives app updates). */
function databasePath() {
  return path.join(app.getPath("userData"), "budgetr.db");
}

/**
 * Bring the user's database up to the bundled schema before the server starts.
 * Runs in the main process, so better-sqlite3 must be built for Electron's ABI
 * (handled by the `electron-rebuild` step wired into the package script).
 */
function runMigrations(dbPath) {
  const Database = require("better-sqlite3");
  const { drizzle } = require("drizzle-orm/better-sqlite3");
  const { migrate } = require("drizzle-orm/better-sqlite3/migrator");

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  try {
    migrate(drizzle(sqlite), {
      migrationsFolder: path.join(appPath, "db", "migrations"),
    });
  } finally {
    sqlite.close();
  }
}

/**
 * Per-user runtime config for the packaged app. A publicly distributed build
 * must not bake anyone's secrets into the bundle, so PLAID_* / FINNHUB_* /
 * APP_ENCRYPTION_KEY live in <userData>/budgetr.env instead — created on first
 * launch with a freshly generated encryption key and empty placeholders the
 * user can fill in (Settings in-app points here).
 */
function userEnvPath() {
  return path.join(app.getPath("userData"), "budgetr.env");
}

function loadUserEnv() {
  const envPath = userEnvPath();
  if (!fs.existsSync(envPath)) {
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(
      envPath,
      [
        "# budgetr settings — quit and reopen the app after editing.",
        "# To link real bank accounts, add Plaid keys from",
        "# https://dashboard.plaid.com/developers/keys and set PLAID_ENV=production.",
        "PLAID_CLIENT_ID=",
        "PLAID_SECRET=",
        "PLAID_ENV=sandbox",
        "# Optional: live intraday prices (free key at https://finnhub.io)",
        "FINNHUB_API_KEY=",
        "# Encrypts Plaid access tokens at rest. Generated on first launch —",
        "# don't change it once accounts are linked, or they'll need re-linking.",
        `APP_ENCRYPTION_KEY=${crypto.randomBytes(32).toString("hex")}`,
        "",
      ].join("\n"),
    );
  }
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    if (line.trim().startsWith("#")) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[2] !== "") env[m[1]] = m[2];
  }
  return env;
}

/** Spawn the Next.js server as a child process. */
function startServer(dbPath, port) {
  if (EXTERNAL_URL) return; // a server is already running; just connect to it

  const nextBin = path.join(appPath, "node_modules", "next", "dist", "bin", "next");
  const command = app.isPackaged ? "start" : "dev";

  // Which Node runs the server matters because better-sqlite3 is a native
  // module with an ABI tied to its Node version:
  //   • Packaged — Electron's own binary as Node (ELECTRON_RUN_AS_NODE); the
  //     bundled better-sqlite3 is built for Electron's ABI during `npm run package`.
  //   • Development — the *system* Node that launched us. This keeps the child on
  //     the default (npm-installed) native-module ABI, so `npm run dev:electron`
  //     and the web/launchd `next start` can share ONE better-sqlite3 build
  //     instead of fighting over its ABI (146 vs 137). Running it as Electron's
  //     Node here would force a rebuild that then breaks `next build`/`next start`.
  const nodeBin = app.isPackaged ? process.execPath : process.env.npm_node_execpath || "node";

  const env = {
    ...process.env,
    // Packaged: secrets come from the per-user budgetr.env, never the bundle.
    ...(app.isPackaged ? loadUserEnv() : {}),
    NODE_ENV: app.isPackaged ? "production" : "development",
    PORT: String(port),
    HOSTNAME: HOST,
  };
  // Packaged only: run Electron's binary as plain Node, and relocate the
  // database to a writable per-user path. In development we run under system
  // Node directly and let the server fall back to ./data/budgetr.db (your dev data).
  if (app.isPackaged) {
    env.ELECTRON_RUN_AS_NODE = "1";
    env.DATABASE_PATH = dbPath;
  }

  // Stream the server's output to a log file so a startup failure is
  // diagnosable after the fact (the dialog points users at this path).
  const logPath = serverLogPath();
  let stdio = "inherit";
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const fd = fs.openSync(logPath, "a");
    fs.writeSync(fd, `\n--- ${command} on :${port} (${new Date().toISOString()}) ---\n`);
    stdio = ["ignore", fd, fd];
  } catch {
    /* fall back to inherited stdio if the log file can't be opened */
  }

  serverProcess = spawn(nodeBin, [nextBin, command, "-p", String(port)], {
    cwd: appPath,
    env,
    stdio,
  });

  serverProcess.on("exit", (code) => {
    const wasRunning = serverProcess !== null;
    serverProcess = null;
    // If the server falls over while the app is up, there's nothing left to show.
    if (wasRunning && !quitting && code) {
      dialog.showErrorBox(
        "budgetr",
        `The local server stopped unexpectedly (exit code ${code}).\n\n` +
          `Details were written to:\n${logPath}`,
      );
      app.quit();
    }
  });
}

function stopServer() {
  if (!serverProcess) return;
  const proc = serverProcess;
  serverProcess = null;
  try {
    proc.kill("SIGTERM");
  } catch {
    /* already gone */
  }
}

/**
 * Resolve once the server is accepting connections on `url`'s host/port, or
 * reject after `timeout` ms.
 *
 * We probe the TCP socket rather than making an HTTP request on purpose: in
 * development the first HTTP hit to a route triggers an on-demand Turbopack
 * compile that can take far longer than any reasonable health-check budget, so
 * an HTTP poll would time out even though the server is up. Once the socket
 * accepts, the window's own loadURL() waits out that first compile (behind
 * loading.html) with no artificial cap.
 */
function waitForServer(url, { timeout = 60000, interval = 300 } = {}) {
  const { hostname, port } = new URL(url);
  const deadline = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect({ host: hostname, port: Number(port) });
      let settled = false;
      const retry = () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (Date.now() > deadline) reject(new Error("Timed out waiting for the server"));
        else setTimeout(attempt, interval);
      };
      socket.once("connect", () => {
        settled = true;
        socket.destroy();
        resolve();
      });
      socket.once("error", retry);
      socket.setTimeout(2000, retry); // don't hang on a half-open connect
    };
    attempt();
  });
}

// Canvas color per theme (matches --ink dark / light in globals.css) — used for
// the frameless window's pre-paint background so light mode doesn't frame dark.
const THEME_BG = { dark: "#080b0a", light: "#f3f0e8" };
let themeWatchersAttached = false;

/** Read the web app's `theme` cookie (dark | light | system), defaulting dark. */
function readThemeChoice() {
  return session.defaultSession.cookies
    .get({ name: "theme" })
    .then((cookies) => {
      const v = cookies[0]?.value;
      return v === "light" || v === "system" ? v : "dark";
    })
    .catch(() => "dark");
}

/** Drive the native chrome (traffic lights, window background) from the choice. */
function applyTheme(choice) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  nativeTheme.themeSource = choice === "light" ? "light" : choice === "system" ? "system" : "dark";
  const resolved =
    choice === "system" ? (nativeTheme.shouldUseDarkColors ? "dark" : "light") : choice;
  mainWindow.setBackgroundColor(THEME_BG[resolved] ?? THEME_BG.dark);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    // Match the app canvas (--ink) so there's no white flash before paint. The
    // saved theme is applied a moment later once the cookie is read (below).
    backgroundColor: "#080b0a",
    // "Frameless" but still usable: drops the title bar, keeps the macOS
    // traffic-light controls inset over the content.
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, "loading.html"));

  // Follow the saved theme: apply once now, then whenever the in-app toggle
  // rewrites the cookie or (under "system") the OS appearance flips.
  readThemeChoice().then(applyTheme);
  if (!themeWatchersAttached) {
    themeWatchersAttached = true;
    session.defaultSession.cookies.on("changed", (_e, cookie) => {
      if (cookie.name === "theme") readThemeChoice().then(applyTheme);
    });
    nativeTheme.on("updated", () => {
      readThemeChoice().then((choice) => {
        if (choice === "system") applyTheme(choice);
      });
    });
  }

  // The window is frameless (titleBarStyle: hiddenInset) with no title bar to
  // grab, so out of the box you can't move it and the macOS traffic lights sit
  // on top of the sidebar. Inject desktop-only CSS (never shipped to the web
  // app) to (1) make the top header a drag handle while keeping its controls
  // clickable, and (2) push the sidebar's contents below the traffic lights.
  // Re-injected on every load since a full navigation clears inserted CSS.
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents
      .insertCSS(
        // Scoped to the layout's own top bar / sidebar (body > div > …) so it
        // never hits nested <header>/<aside> in drawers like transaction-detail.
        `
        body > div > div > header { -webkit-app-region: drag; }
        body > div > div > header button, body > div > div > header a,
        body > div > div > header input, body > div > div > header select,
        body > div > div > header label,
        body > div > div > header [role="button"] { -webkit-app-region: no-drag; }
        body > div > aside > div { padding-top: 44px; }
        `,
      )
      .catch(() => {});
  });

  // Open target=_blank / external links in the system browser, not a new window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (serverUrl && url.startsWith(serverUrl)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/**
 * App menu with direct access to the per-user settings file and data folder,
 * so non-technical users never have to hunt for
 * ~/Library/Application Support/budgetr/budgetr.env by hand.
 */
function buildMenu() {
  const template = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              {
                label: "Check for Updates…",
                click: () => checkForUpdates({ manual: true }),
              },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      label: "Settings",
      submenu: [
        {
          label: "Open Settings File (budgetr.env)…",
          accelerator: "CmdOrCtrl+,",
          click: () => {
            loadUserEnv(); // ensures the file exists before opening it
            shell.openPath(userEnvPath());
          },
        },
        {
          label: "Show Data Folder",
          click: () => shell.showItemInFolder(databasePath()),
        },
        { type: "separator" },
        {
          label: "Relaunch to Apply Settings",
          click: () => {
            app.relaunch();
            app.quit();
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Auto-update ─────────────────────────────────────────────────────────────
// electron-updater pulls new releases from the GitHub Releases feed (configured
// via build.publish in package.json, baked into app-update.yml at pack time).
// The app updates the whole bundle; the user's database and budgetr.env live in
// userData and are untouched, and migrations re-run on the next launch.
//
// IMPORTANT: macOS auto-update (Squirrel.Mac) only works on a build signed with
// a Developer ID and notarized. On the current ad-hoc/unsigned builds the check
// simply errors — we swallow that (unless the user explicitly asked), so nothing
// breaks; it starts working once the signing secrets are in place.
let autoUpdater = null;
let updaterWired = false;
let manualCheck = false;

function updaterLog(msg) {
  try {
    fs.appendFileSync(serverLogPath(), `[updater ${new Date().toISOString()}] ${msg}\n`);
  } catch {
    /* best effort — logging must never take the app down */
  }
}

function initAutoUpdater() {
  if (updaterWired) return autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (err) {
    updaterLog(`electron-updater unavailable: ${err && err.message ? err.message : err}`);
    return null;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: updaterLog, warn: updaterLog, error: updaterLog, debug: () => {} };

  autoUpdater.on("error", (err) => {
    updaterLog(`error: ${err && err.message ? err.message : err}`);
    if (manualCheck) {
      manualCheck = false;
      dialog.showMessageBox({
        type: "info",
        message: "Couldn’t check for updates",
        detail: "budgetr will try again automatically later. See server.log for details.",
        buttons: ["OK"],
      });
    }
  });

  autoUpdater.on("update-not-available", () => {
    if (manualCheck) {
      manualCheck = false;
      dialog.showMessageBox({
        type: "info",
        message: "budgetr is up to date",
        detail: `You’re on version ${app.getVersion()}.`,
        buttons: ["OK"],
      });
    }
  });

  autoUpdater.on("update-available", (info) => {
    updaterLog(`update available: ${info && info.version} (downloading)`);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    manualCheck = false;
    const { response } = await dialog.showMessageBox({
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: `budgetr ${info && info.version ? info.version : ""} is ready to install`,
      detail: "Restart to finish updating. Your data and settings are kept.",
    });
    if (response === 0) {
      quitting = true;
      stopServer();
      autoUpdater.quitAndInstall();
    }
  });

  updaterWired = true;
  return autoUpdater;
}

function checkForUpdates({ manual = false } = {}) {
  if (!app.isPackaged) {
    if (manual) {
      dialog.showMessageBox({
        type: "info",
        message: "Updates are disabled in development",
        detail: "Run a packaged build to test auto-update.",
        buttons: ["OK"],
      });
    }
    return;
  }
  const updater = initAutoUpdater();
  if (!updater) return;
  manualCheck = manual;
  Promise.resolve(updater.checkForUpdates()).catch((err) =>
    updaterLog(`check failed: ${err && err.message ? err.message : err}`),
  );
}

async function boot() {
  const dbPath = databasePath();

  buildMenu();

  if (app.isPackaged) {
    try {
      runMigrations(dbPath);
    } catch (err) {
      dialog.showErrorBox(
        "budgetr — database error",
        `Could not prepare the database:\n\n${err && err.message ? err.message : err}`,
      );
      app.quit();
      return;
    }
  }

  createWindow();

  if (!EXTERNAL_URL) {
    let port;
    try {
      port = await choosePort();
    } catch (err) {
      dialog.showErrorBox(
        "budgetr",
        `Could not find a free port to start the server.\n\n${err && err.message ? err.message : err}`,
      );
      app.quit();
      return;
    }
    serverUrl = `http://${HOST}:${port}`;
    startServer(dbPath, port);
  }

  try {
    await waitForServer(serverUrl);
    if (mainWindow) await mainWindow.loadURL(serverUrl);
    // Check for updates once the app has settled, then every 6 hours.
    if (app.isPackaged) {
      setTimeout(() => checkForUpdates(), 8000);
      setInterval(() => checkForUpdates(), 6 * 60 * 60 * 1000);
    }
  } catch (err) {
    if (mainWindow) {
      await mainWindow.loadFile(path.join(__dirname, "loading.html"), {
        hash: "error",
      });
    }
    dialog.showErrorBox(
      "budgetr",
      `The app couldn't reach the local server.\n\n${err && err.message ? err.message : err}`,
    );
  }
}

// A single instance owns the server + port; a second launch just focuses it.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(boot);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) boot();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", () => {
    quitting = true;
    stopServer();
  });

  app.on("will-quit", stopServer);
  process.on("exit", stopServer);
}
