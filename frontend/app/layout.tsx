import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "InterviewGuard", description: "Human-reviewed interview integrity monitoring" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="sq"><body>{children}</body></html>;
}

