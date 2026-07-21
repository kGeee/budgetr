// budgetr companion palette — matches the desktop app's dark ledger look.
export const T = {
  bg: "#101418",
  panel: "#1a2027",
  panel2: "#212a33",
  line: "#2b3540",
  paper: "#e6ebf0",
  muted: "#8a97a5",
  jade: "#6fe3a6",
  brass: "#d4a73a",
  coral: "#ff7a76",
  amber: "#e8a13c",
} as const;

export const stateColor = { ok: T.jade, warn: T.amber, over: T.coral } as const;
