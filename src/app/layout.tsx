import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";

// Distinctive-but-clean grotesque for the whole app (UI + notes).
const uiFont = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Meeting Hub",
  description: "Personal meeting notes and action items",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
