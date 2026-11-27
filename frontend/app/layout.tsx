import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Files live in ./fonts (see its README): no download at build time, no request to Google when a page loads.
const sora = localFont({
  src: "./fonts/sora-latin.woff2",
  weight: "400 700",
  variable: "--font-sora",
  display: "swap",
});

const plexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-500-latin.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = { title: { default: "NemoGuardHR", template: "%s · NemoGuardHR" }, description: "Calls, tests, and live activity signals for host review" };

// Runs before the first paint so a dark-theme reader never sees a white flash. Storage may be blocked: fall back to the OS setting.
const themeScript = `try{var t=localStorage.getItem("ng-theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sq" className={`${sora.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a href="#main" className="skip-link">Kalo te përmbajtja</a>
        {children}
      </body>
    </html>
  );
}
