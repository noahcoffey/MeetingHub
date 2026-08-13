import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import "./globals.css";

// Distinctive-but-clean grotesque for the whole app (UI + notes).
//
// Self-hosted rather than pulled from `next/font/google`, which fetches at
// BUILD time: a blip reaching fonts.googleapis.com failed the build outright,
// on CI and equally on a Dokploy deploy. The file is the same one Google serves
// for the `latin` subset, and it's the variable version, so one 34KB file
// covers every weight the app uses instead of four static cuts. Licence in
// ./fonts/OFL.txt — keep it next to the font.
const uiFont = localFont({
  src: "./fonts/hanken-grotesk-latin-variable.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Meeting Hub",
  description: "Personal meeting notes and action items",
  // Installed-PWA behavior on iOS (Android reads manifest.ts instead).
  appleWebApp: {
    capable: true,
    title: "MeetingHub",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // cover + safe-area-inset-* CSS keeps the app out from under the notch and
  // home indicator when installed to a phone home screen.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0c0f" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // CSP nonce set by middleware (production); undefined in dev where CSP is off.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // Set the theme before paint (no flash): stored choice wins, else system pref.
  const themeInit = `(function(){try{var t=localStorage.getItem('mh:theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);document.documentElement.setAttribute('data-trend',localStorage.getItem('mh:trend')==='1'?'on':'off');}catch(e){}})();`;
  return (
    <html lang="en" className={uiFont.variable} suppressHydrationWarning>
      <body>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInit }} />
        {children}
      </body>
    </html>
  );
}
