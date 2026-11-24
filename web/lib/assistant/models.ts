/**
 * The Claude models the AI assistant can run on. Shared by the Settings picker
 * (client) and the chat route (server), so it holds no secrets and no DB access.
 *
 * The user pays for every call with their own Anthropic key, so the picker says
 * plainly which model is the most capable and which is the cheapest.
 */

export type AssistantModel = {
  id: string;
  label: string;
  /** One line under the option in Settings. */
  hint: string;
  /** Server-side refusal fallback ("default" routing) is available for this model. */
  fallbacks: boolean;
};

export const ASSISTANT_MODELS: readonly AssistantModel[] = [
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    hint: "Most capable. Best for questions that need several lookups.",
    fallbacks: true,
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    hint: "Fast and capable, about half the cost of Opus.",
    fallbacks: true,
  },
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    hint: "Fastest and cheapest. Good for simple questions.",
    fallbacks: false,
  },
] as const;

export const DEFAULT_ASSISTANT_MODEL = ASSISTANT_MODELS[0].id;

/** The stored model id if it's one we offer, else the default. */
export function resolveAssistantModel(id: string | null | undefined): AssistantModel {
  return ASSISTANT_MODELS.find((m) => m.id === id) ?? ASSISTANT_MODELS[0];
}
