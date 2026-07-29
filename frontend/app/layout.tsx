import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Nemo Call", description: "Calls, tests, and live activity signals for host review" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="sq"><body>{children}</body></html>;
}
