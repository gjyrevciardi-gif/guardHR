import type { Metadata } from "next";

export const metadata: Metadata = { title: "Hyrje në call" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
