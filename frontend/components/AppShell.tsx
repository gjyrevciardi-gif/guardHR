"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/api";
import { ShellMark } from "@/components/ShellMark";
import { Wordmark } from "@/components/Wordmark";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const navClass = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-full px-4 transition ${active ? "bg-shell-200 font-semibold text-teal" : "text-slate-600 hover:bg-shell-100 hover:text-navy"}`;

  return (
    <div className="shell-field min-h-screen text-navy">
      <header className="sticky top-0 z-40 border-b border-white/70 bg-white/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
          <Link href="/dashboard" className="flex min-h-11 items-center gap-3 font-bold">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-shell-200">
              <ShellMark className="h-7 w-7" />
            </span>
            <Wordmark />
          </Link>
          <nav aria-label="Kryesore" className="flex items-center gap-2 text-sm">
            <Link href="/dashboard" aria-current={pathname === "/dashboard" ? "page" : undefined} className={navClass(pathname === "/dashboard")}>Dashboard</Link>
            <Link href="/tests" aria-current={pathname.startsWith("/tests") ? "page" : undefined} className={navClass(pathname.startsWith("/tests"))}>Teste</Link>
            <button
              onClick={() => void logout()}
              className="flex min-h-11 items-center gap-2 rounded-full px-4 text-slate-600 hover:bg-shell-100 hover:text-navy"
            >
              <LogOut size={16} /> Dil
            </button>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-5 py-8">{children}</main>
    </div>
  );
}
