import type { Metadata } from "next";

export const metadata: Metadata = { title: "Rivendos fjalëkalimin" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
