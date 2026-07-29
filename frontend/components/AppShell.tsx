"use client";

import { LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken } from "@/lib/api";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  return <div className="min-h-screen bg-mist">
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
        <Link href="/dashboard" className="flex items-center gap-3 font-bold text-navy"><span className="rounded-xl bg-navy p-2 text-white"><ShieldCheck size={20}/></span>InterviewGuard</Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/dashboard" className={`rounded-lg px-3 py-2 ${pathname === "/dashboard" ? "bg-slate-100 font-semibold" : "text-slate-600"}`}>Dashboard</Link>
          <Link href="/tests/new" className={`rounded-lg px-3 py-2 ${pathname.startsWith("/tests") ? "bg-slate-100 font-semibold" : "text-slate-600"}`}>Teste</Link>
          <button onClick={() => { clearToken(); router.push("/login"); }} className="flex items-center gap-2 rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100"><LogOut size={16}/> Dil</button>
        </nav>
      </div>
    </header>
    <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
  </div>;
}
