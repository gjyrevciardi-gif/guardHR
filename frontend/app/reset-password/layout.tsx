import type { Metadata } from "next";

// The link carries a one-time secret in its query string: never send it on as a Referer, never index it.
export const metadata: Metadata = { title: "Fjalëkalim i ri", referrer: "no-referrer", robots: { index: false, follow: false } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
