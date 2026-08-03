"use client";

import { LogOut, Waves } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken } from "@/lib/api";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const navClass = (active: boolean) =>
    `rounded-full px-4 py-2 transition ${active ? "bg-sky-100 font-semibold text-teal" : "text-slate-600 hover:bg-sky-50 hover:text-navy"}`;

  return (
    <div className="constellation min-h-screen text-navy">
      <header className="sticky top-0 z-40 border-b border-white/70 bg-white/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4">
          <Link href="/dashboard" className="flex items-center gap-3 font-bold">
            <span className="rounded-full bg-sky-100 p-2 text-teal"><Waves size={18} /></span>
            Nemo Call
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/dashboard" className={navClass(pathname === "/dashboard")}>Dashboard</Link>
            <Link href="/tests/new" className={navClass(pathname.startsWith("/tests"))}>Teste</Link>
            <button
              onClick={() => { clearToken(); router.push("/login"); }}
              className="flex items-center gap-2 rounded-full px-4 py-2 text-slate-600 hover:bg-sky-50 hover:text-navy"
            >
              <LogOut size={16} /> Dil
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
    </div>
  );
}
