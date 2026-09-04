/**
 * Client typings for the Electron preload bridge (desktop/electron/preload.js).
 * Only present in the packaged desktop shell — web/dev builds leave this undefined.
 */

export type BudgetrDesktopBridge = {
  platform: NodeJS.Platform;
  getUserDataPath: () => Promise<string>;
  openDataFolder: () => Promise<void>;
  completePrivacyGate: () => Promise<void>;
  quitApp: () => Promise<void>;
};

declare global {
  interface Window {
    budgetrDesktop?: BudgetrDesktopBridge;
  }
}

export {};
