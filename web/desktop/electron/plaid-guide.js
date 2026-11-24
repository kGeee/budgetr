// In-app browser pane for the guided Plaid setup.
//
// budgetr users bring their own Plaid keys, and the hard part of onboarding is
// signing up in Plaid's dashboard and finding the Keys page. The onboarding UI
// (components/onboarding/plaid-guided-setup.tsx) shows a step checklist on the
// left; this module puts Plaid's dashboard in a browser pane on the right — a
// WebContentsView laid over a placeholder the page reserves and reports the
// bounds of.
//
// Ground rules:
//  - The pane is a plain, sandboxed browser: no preload, no Node, its own
//    in-memory session (nothing persists after quit, and it never shares
//    cookies with the app).
//  - budgetr never reads the page. The only thing that crosses back to the app
//    is the page ADDRESS (plus title / loading / history state), which the
//    checklist uses to tick steps. Keys are copied and pasted by the user.
//  - Only Plaid pages (plaid.com and its subdomains, over https) load in the
//    pane, and the app itself can only point it at dashboard.plaid.com. Any
//    other page a link, redirect or popup leads to opens in the user's own
//    browser instead (and the guide says so). Google sign-in is refused inside
//    embedded browsers, so it is stopped with an explanation rather than left
//    to fail.

const { WebContentsView, ipcMain, shell } = require("electron");
const { DASHBOARD_HOST, parse, isPlaidHost, isDashboardUrl, routeUrl, sanitizeBounds } = require("./url-guards");

// In-memory partition: not "persist:", so a Plaid sign-in in the pane is gone
// when budgetr quits.
const PARTITION = "plaid-guide";

/**
 * Wire the IPC handlers. `getWindow` returns the main BrowserWindow (or null);
 * `getServerUrl` returns the local server origin, so only budgetr's own pages
 * can drive the pane.
 */
let registered = false;

function registerPlaidGuide({ getWindow, getServerUrl }) {
  // boot() runs again when the dock icon re-opens a closed window; IPC
  // handlers can only be registered once.
  if (registered) return;
  registered = true;

  let view = null;
  let attachedTo = null;
  const wired = new WeakSet();

  const trusted = (event) => {
    const win = getWindow();
    const origin = getServerUrl();
    if (!win || win.isDestroyed() || !origin) return false;
    if (event.sender !== win.webContents) return false;
    const frameUrl = (event.senderFrame && event.senderFrame.url) || "";
    return frameUrl === origin || frameUrl.startsWith(`${origin}/`);
  };

  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  const pushState = () => {
    if (!view || view.webContents.isDestroyed()) return;
    const wc = view.webContents;
    send("plaid-guide:state", {
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    });
  };

  const blocked = (raw, reason) => send("plaid-guide:blocked", { url: raw, reason });

  /**
   * Decide what happens to a top-level navigation the page starts (link,
   * redirect or popup). Returns true to let it load in the pane.
   */
  const allowInPane = (raw) => {
    switch (routeUrl(raw)) {
      case "pane":
        return true;
      case "google":
        blocked(raw, "google");
        return false;
      case "external":
        shell.openExternal(raw).catch(() => {});
        if (!raw.startsWith("mailto:")) blocked(raw, "external");
        return false;
      default:
        return false;
    }
  };

  const create = () => {
    view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
      },
    });
    const wc = view.webContents;

    // Present as the Chrome it is, without the Electron / app tokens, so Plaid
    // serves its normal dashboard.
    wc.setUserAgent(wc.getUserAgent().replace(/\s(Electron|budgetr)\/\S+/g, ""));

    // No camera, mic, notifications, geolocation, … for pages in the pane.
    wc.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    wc.session.setPermissionCheckHandler(() => false);

    // Only top-level navigations are routed. Iframes on Plaid's pages (captcha,
    // analytics, embedded widgets) may load or redirect to other hosts; they
    // can't take the user anywhere, so they're left alone rather than being
    // cancelled and sent to the user's browser.
    const route = (details) => {
      if (details.isMainFrame && !allowInPane(details.url)) details.preventDefault();
    };
    wc.on("will-navigate", route);
    wc.on("will-redirect", route);

    // New windows follow the same rule: Plaid pages open in the pane, Google
    // sign-in is explained, anything else goes to the user's own browser.
    wc.setWindowOpenHandler(({ url: raw }) => {
      if (allowInPane(raw)) wc.loadURL(raw).catch(() => {});
      return { action: "deny" };
    });

    for (const ev of [
      "did-start-loading",
      "did-stop-loading",
      "did-navigate",
      "did-navigate-in-page",
      "page-title-updated",
    ]) {
      wc.on(ev, pushState);
    }
    wc.on("did-fail-load", (_e, code, _desc, failedUrl, isMainFrame) => {
      // -3 is ERR_ABORTED: our own preventDefault, or a superseded load.
      if (isMainFrame && code !== -3) send("plaid-guide:error", { url: failedUrl, code });
      pushState();
    });
  };

  const close = () => {
    if (!view) return;
    const v = view;
    view = null;
    try {
      if (attachedTo && !attachedTo.isDestroyed()) attachedTo.contentView.removeChildView(v);
    } catch {
      /* window already gone */
    }
    attachedTo = null;
    if (!v.webContents.isDestroyed()) v.webContents.close();
  };

  ipcMain.handle("plaid-guide:open", async (event, { url: raw, bounds } = {}) => {
    if (!trusted(event) || !isDashboardUrl(raw)) return { ok: false };
    const win = getWindow();
    if (!view) create();
    if (attachedTo !== win) {
      win.contentView.addChildView(view);
      attachedTo = win;
      if (!wired.has(win)) {
        wired.add(win);
        // Tear down with the app's page: a full reload or a crash must not
        // strand the pane over whatever loads next. (Client-side route changes
        // are same-document and don't count; the page closes the pane itself.)
        win.webContents.on("did-start-navigation", (details) => {
          if (details && details.isMainFrame && !details.isSameDocument) close();
        });
        win.webContents.on("render-process-gone", close);
        win.once("closed", close);
      }
    }
    view.setBounds(sanitizeBounds(bounds));
    view.webContents.loadURL(raw).catch(() => {});
    return { ok: true };
  });

  ipcMain.on("plaid-guide:bounds", (event, bounds) => {
    if (!trusted(event) || !view) return;
    view.setBounds(sanitizeBounds(bounds));
  });

  ipcMain.handle("plaid-guide:navigate", (event, raw) => {
    if (!trusted(event) || !view || !isDashboardUrl(raw)) return { ok: false };
    view.webContents.loadURL(raw).catch(() => {});
    return { ok: true };
  });

  ipcMain.handle("plaid-guide:command", (event, cmd) => {
    if (!trusted(event) || !view) return { ok: false };
    const wc = view.webContents;
    if (cmd === "back" && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (cmd === "forward" && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (cmd === "reload") wc.reload();
    else if (cmd === "focus") wc.focus();
    return { ok: true };
  });

  // "Open in browser": the page the pane is on (or a given Plaid page, e.g. the
  // Google sign-in hand-off), in the user's default browser.
  ipcMain.handle("plaid-guide:open-external", (event, raw) => {
    if (!trusted(event)) return { ok: false };
    const target = raw || (view && !view.webContents.isDestroyed() ? view.webContents.getURL() : "");
    const u = parse(target);
    if (!u || u.protocol !== "https:" || !isPlaidHost(u.hostname)) {
      // Never hand an arbitrary page to the OS; fall back to the dashboard.
      shell.openExternal(`https://${DASHBOARD_HOST}/signup`).catch(() => {});
      return { ok: true };
    }
    shell.openExternal(u.toString()).catch(() => {});
    return { ok: true };
  });

  ipcMain.handle("plaid-guide:close", (event) => {
    if (!trusted(event)) return { ok: false };
    close();
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.focus();
    return { ok: true };
  });
}

module.exports = { registerPlaidGuide };
