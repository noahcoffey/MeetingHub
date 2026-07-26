import type { MetadataRoute } from "next";

// PWA manifest: makes the app installable to a phone home screen and run in
// standalone mode (no browser chrome). Served at /manifest.webmanifest —
// excluded from the middleware matcher so the (credential-less) manifest
// fetch browsers make doesn't bounce off the login redirect. Android uses
// the SVG icons below; iOS uses apple-icon.tsx instead.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MeetingHub",
    short_name: "MeetingHub",
    description: "Personal meeting notes and action items",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0c0f",
    theme_color: "#0b0c0f",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      {
        src: "/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
