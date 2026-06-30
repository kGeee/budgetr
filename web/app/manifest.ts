import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "budgetr — private ledger",
    short_name: "budgetr",
    description: "Net worth, spending & income — read-only, on your machine.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#080b0a",
    theme_color: "#080b0a",
    categories: ["finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Transactions", url: "/transactions", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Budgets", url: "/budgets", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
