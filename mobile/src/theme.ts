// budgetr "Private Ledger" theme — ported 1:1 from web/app/globals.css.
// Warm ivory ink on deep forest-black, brass hairlines, jade/coral semantics.

export const T = {
  ink: "#080b0a", // canvas
  panel: "#131a18", // card surface
  panel2: "#1c2421", // raised / hover (cards gradient panel-2 → panel)
  line: "#2b3531", // hairline border
  lineStrong: "#3a4742",
  paper: "#ece7da", // primary text — warm ivory
  muted: "#8b948c", // secondary text
  faint: "#5d655f", // tertiary
  jade: "#6fe3a6", // positive / accent
  jadeDeep: "#2f9d72",
  coral: "#f0897b", // negative
  brass: "#cbb07c", // premium hairline accents
  brassDim: "#8a7748",
  onJade: "#06120c",
  blue: "#7fb2e0",
  radius: 18,
} as const;

// Loaded in _layout.tsx via @expo-google-fonts — same faces as the desktop:
// Fraunces (display), Hanken Grotesk (sans), Spline Sans Mono (numbers).
export const F = {
  display: "Fraunces_600SemiBold",
  displayBold: "Fraunces_700Bold",
  sans: "HankenGrotesk_400Regular",
  sansMedium: "HankenGrotesk_500Medium",
  sansSemiBold: "HankenGrotesk_600SemiBold",
  sansBold: "HankenGrotesk_700Bold",
  mono: "SplineSansMono_500Medium",
  monoSemiBold: "SplineSansMono_600SemiBold",
} as const;

export const stateColor = { ok: T.jade, warn: T.brass, over: T.coral } as const;
