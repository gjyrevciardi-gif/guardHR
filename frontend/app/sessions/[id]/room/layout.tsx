import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dhoma e call-it" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
