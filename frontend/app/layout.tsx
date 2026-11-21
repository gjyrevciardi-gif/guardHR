import type { Metadata } from "next";
import { IBM_Plex_Mono, Sora } from "next/font/google";
import "./globals.css";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-sora",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = { title: { default: "NemoGuardHR", template: "%s · NemoGuardHR" }, description: "Calls, tests, and live activity signals for host review" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sq" className={`${sora.variable} ${plexMono.variable}`}>
      <body>
        <a href="#main" className="skip-link">Kalo te përmbajtja</a>
        {children}
      </body>
    </html>
  );
}
