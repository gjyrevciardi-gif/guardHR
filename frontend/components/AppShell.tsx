"use client";

import { LayoutDashboard, ListChecks, LogOut, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/api";
import { ShellMark } from "@/components/ShellMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Wordmark } from "@/components/Wordmark";

const nav = [
  { href: "/dashboard", label: "Paneli", icon: LayoutDashboard, match: (path: string) => path === "/dashboard" || path.startsWith("/sessions") },
  { href: "/tests", label: "Teste", icon: ListChecks, match: (path: string) => path.startsWith("/tests") },
  { href: "/settings", label: "Cilësimet", icon: Settings, match: (path: string) => path.startsWith("/settings") },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-canvas text-navy">
      <header className="sticky top-0 z-40 border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-1 px-5 py-2.5">
          <Link href="/dashboard" className="flex min-h-11 items-center gap-3 font-bold">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-shell-200">
              <ShellMark className="h-6 w-6" />
            </span>
            <Wordmark />
          </Link>
          <nav aria-label="Kryesore" className="order-3 -mx-1 flex w-full items-center gap-1 overflow-x-auto text-sm md:order-none md:mx-0 md:w-auto md:flex-1">
            {nav.map(({ href, label, icon: Icon, match }) => {
              const active = match(pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3.5 font-semibold transition ${active ? "bg-shell-200 text-teal" : "text-slate-600 hover:bg-shell-100 hover:text-navy"}`}
                >
                  <Icon size={17} aria-hidden="true" /> {label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <Link href="/sessions/new" className="btn-primary hidden sm:inline-flex"><Plus size={17} aria-hidden="true" /> Call i ri</Link>
            <ThemeToggle />
            <button onClick={() => void logout()} className="btn-ghost !px-3" aria-label="Dil">
              <LogOut size={17} aria-hidden="true" /> <span className="hidden lg:inline">Dil</span>
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-5 py-8">{children}</main>
    </div>
  );
}
