import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Call · NemoGuardHR", template: "%s · NemoGuardHR" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
