"use client";

/**
 * The desktop app's preload (desktop/electron/preload.js) exposes a small bridge
 * on `window.budgetrDesktop`. In a normal browser it's absent, so every feature
 * that uses it must also work — or hide itself — without it.
 */

import { useEffect, useState } from "react";

export type GuideBounds = { x: number; y: number; width: number; height: number };

export type GuidePaneState = {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

export type PlaidGuideBridge = {
  open(url: string, bounds: GuideBounds): Promise<{ ok: boolean }>;
  setBounds(bounds: GuideBounds): void;
  navigate(url: string): Promise<{ ok: boolean }>;
  back(): Promise<unknown>;
  forward(): Promise<unknown>;
  reload(): Promise<unknown>;
  focus(): Promise<unknown>;
  /** Open a Plaid page (default: the one the pane is on) in the user's own browser. */
  openInBrowser(url?: string): Promise<unknown>;
  close(): Promise<unknown>;
  onState(cb: (s: GuidePaneState) => void): () => void;
  onBlocked(cb: (b: { url: string; reason: "google" }) => void): () => void;
  onError(cb: (e: { url: string; code: number }) => void): () => void;
};

type DesktopBridge = { plaidGuide?: PlaidGuideBridge };

declare global {
  interface Window {
    budgetrDesktop?: DesktopBridge;
  }
}

/**
 * The Plaid guide bridge when running in the desktop app, else null. Resolved
 * after mount so server and client render the same markup.
 */
export function usePlaidGuideBridge(): PlaidGuideBridge | null {
  const [bridge, setBridge] = useState<PlaidGuideBridge | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot read of a window global after hydration
    setBridge(window.budgetrDesktop?.plaidGuide ?? null);
  }, []);
  return bridge;
}
