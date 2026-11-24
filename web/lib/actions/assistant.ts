"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { demoEnabled } from "@/lib/site";
import {
  acknowledgeAssistantNotice,
  getAssistantModel,
  setAssistantEnabled,
  setAssistantKey,
  setAssistantModel,
} from "@/lib/assistant/settings";

/**
 * Settings server actions for the optional AI assistant. All of them refuse on
 * the public web demo, where the assistant doesn't exist.
 */

type Result = { ok: true } | { ok: false; error: string };

function refuseOnDemo(): Result | null {
  return demoEnabled() ? { ok: false, error: "Not available in the demo." } : null;
}

/** Switch the assistant on or off. Off hides the chat bubble; the saved key stays. */
export async function setAssistantOn(on: boolean): Promise<Result> {
  const demo = refuseOnDemo();
  if (demo) return demo;
  setAssistantEnabled(on);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Check the key with Anthropic (a free model lookup, no tokens spent) and save
 * it encrypted. A key Anthropic rejects is never stored.
 */
export async function saveAssistantKey(key: string): Promise<Result> {
  const demo = refuseOnDemo();
  if (demo) return demo;
  const k = key.trim();
  if (!k) return { ok: false, error: "Paste your Anthropic API key first." };
  try {
    await new Anthropic({ apiKey: k, maxRetries: 1, timeout: 15_000 }).models.retrieve(
      getAssistantModel().id,
    );
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: "Anthropic didn't accept that key. Check you copied all of it." };
    }
    if (err instanceof Anthropic.PermissionDeniedError || err instanceof Anthropic.NotFoundError) {
      return { ok: false, error: "That key works but can't use the selected model. Pick another model and try again." };
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return { ok: false, error: "Couldn't reach Anthropic to check the key. Check your connection and try again." };
    }
    return { ok: false, error: "Couldn't check the key with Anthropic just now. Try again." };
  }
  setAssistantKey(k);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Forget the saved key. */
export async function removeAssistantKey(): Promise<Result> {
  const demo = refuseOnDemo();
  if (demo) return demo;
  setAssistantKey(null);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function chooseAssistantModel(id: string): Promise<Result> {
  const demo = refuseOnDemo();
  if (demo) return demo;
  setAssistantModel(id);
  revalidatePath("/settings");
  return { ok: true };
}

/** Record that the user read the notice about what is sent to Anthropic. */
export async function acceptAssistantNotice(): Promise<Result> {
  const demo = refuseOnDemo();
  if (demo) return demo;
  acknowledgeAssistantNotice();
  revalidatePath("/", "layout");
  return { ok: true };
}
