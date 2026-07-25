import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "What Is This?",
    short_name: "What Is This",
    description: "Identify an object, learn about it, and save it for later.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7f2",
    theme_color: "#166c5f",
    orientation: "portrait",
    categories: ["utilities", "shopping", "education"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
