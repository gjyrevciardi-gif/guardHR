import Link from "next/link";
import { SampleCall } from "@/components/SampleCall";
import { ShellMark } from "@/components/ShellMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Wordmark } from "@/components/Wordmark";

/** Login and register share one frame: a short promise and a sample call on the left (large screens), the form on the right. */
export function AuthShell({ kicker, title, blurb, children }: { kicker: string; title: React.ReactNode; blurb: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen bg-canvas text-navy lg:grid-cols-[1.05fr_.95fr]">
      <aside className="hidden flex-col justify-between gap-10 border-r border-line p-12 lg:flex">
        <Link href="/" className="flex items-center gap-3 font-bold">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-shell-200"><ShellMark className="h-7 w-7" /></span>
          <span><Wordmark /></span>
        </Link>
        <div className="max-w-lg">
          <p className="eyebrow">{kicker}</p>
          <p className="mt-4 text-4xl font-bold leading-[1.1] tracking-tight">{title}</p>
          <p className="mt-5 leading-7 text-slate-600">{blurb}</p>
          <div className="mt-8"><SampleCall showSignals={false} /></div>
        </div>
        <p className="text-sm text-muted">Sinjale për shqyrtim, jo verdikte.</p>
      </aside>

      <main id="main" className="flex flex-col p-5 sm:p-8">
        <div className="flex items-center justify-between lg:justify-end">
          <Link href="/" className="flex items-center gap-2.5 font-bold lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-shell-200"><ShellMark className="h-6 w-6" /></span>
            <span><Wordmark /></span>
          </Link>
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center py-8">{children}</div>
      </main>
    </div>
  );
}
