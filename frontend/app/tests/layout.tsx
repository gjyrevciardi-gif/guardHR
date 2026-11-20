import type { Metadata } from "next";

export const metadata: Metadata = {
  // A parent that sets its own title drops the root template for its children, so it restates it.
  title: { default: "Teste & formularë · NemoGuardHR", template: "%s · NemoGuardHR" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
