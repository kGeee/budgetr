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

const { app, BrowserWindow, dialog, shell } = require("electron");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const fs = require("node:fs");
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

/** Spawn the Next.js server as a child process using Electron's bundled Node. */
function startServer(dbPath, port) {
  if (EXTERNAL_URL) return; // a server is already running; just connect to it

  const nextBin = path.join(appPath, "node_modules", "next", "dist", "bin", "next");
  const command = app.isPackaged ? "start" : "dev";

  const env = {
    ...process.env,
    // Run the child as plain Node rather than a second Electron instance.
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: app.isPackaged ? "production" : "development",
    PORT: String(port),
    HOSTNAME: HOST,
  };
  // Only the packaged app relocates the database; in development we let the
  // server fall back to its usual ./data/budgetr.db so you see your dev data.
  if (app.isPackaged) env.DATABASE_PATH = dbPath;

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

  serverProcess = spawn(process.execPath, [nextBin, command, "-p", String(port)], {
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

/** Resolve once the server answers on `url`, or reject after `timeout` ms. */
function waitForServer(url, { timeout = 60000, interval = 300 } = {}) {
  const deadline = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume(); // drain so the socket frees up
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("Timed out waiting for the server"));
        else setTimeout(attempt, interval);
      });
      req.setTimeout(2000, () => req.destroy());
    };
    attempt();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    // Match the app canvas (--ink) so there's no white flash before paint.
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

async function boot() {
  const dbPath = databasePath();

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
