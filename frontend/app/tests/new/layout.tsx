import type { Metadata } from "next";

export const metadata: Metadata = { title: "Test i ri" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
