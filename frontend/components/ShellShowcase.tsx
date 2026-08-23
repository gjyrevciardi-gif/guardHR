import type { CSSProperties } from "react";
import { Activity, Copy, Eye, Maximize2, Radio } from "lucide-react";
import { ShellMark } from "@/components/ShellMark";

const bubbles = [
  { left: "10%", size: 10, delay: "0s", duration: "9s" },
  { left: "19%", size: 6, delay: "1.4s", duration: "7s" },
  { left: "33%", size: 12, delay: "2.2s", duration: "10s" },
  { left: "52%", size: 7, delay: ".6s", duration: "8s" },
  { left: "70%", size: 11, delay: "1.9s", duration: "9.5s" },
  { left: "86%", size: 8, delay: ".9s", duration: "7.8s" },
];

const signals = [
  { icon: Eye, title: "Tab/app change", value: "12s", tone: "warn" as const },
  { icon: Copy, title: "Copy/paste", value: "detected", tone: "warn" as const },
  { icon: Maximize2, title: "Window resized", value: "119%", tone: "calm" as const },
];

export function ShellShowcase() {
  return (
    <div className="shell-card relative min-h-[520px] overflow-hidden rounded-[2.25rem] border border-white/80 p-5 shadow-soft">
      <div className="absolute inset-x-8 top-8 z-10 flex items-center justify-between rounded-full border border-white/80 bg-white/80 px-4 py-3 text-sm font-semibold text-navy backdrop-blur-xl">
        <span className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-moss" />
          Live room · 24:06
        </span>
        <span className="rounded-full bg-shell-200 px-3 py-1 text-xs text-shell-800">connected</span>
      </div>

      <div className="absolute inset-x-10 top-24 z-10 rounded-[2rem] border border-white/80 bg-white/60 p-4 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-shell-200 text-teal">
            <Activity className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-navy">Signals to review</p>
            <p className="text-xs text-slate-600">Visible only to host</p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {signals.map((signal) => {
            const Icon = signal.icon;
            const warn = signal.tone === "warn";
            return (
              <div key={signal.title} className="flex items-center justify-between rounded-2xl bg-white/90 px-3 py-2 text-xs text-slate-700 shadow-sm">
                <span className="flex items-center gap-2 font-semibold">
                  <span className={`h-2 w-2 rounded-full ${warn ? "bg-gold" : "bg-moss"}`} />
                  <Icon className={`h-4 w-4 ${warn ? "text-gold-text" : "text-moss"}`} />
                  {signal.title}
                </span>
                <span className={`rounded-full px-2.5 py-1 font-mono font-medium ${warn ? "bg-gold-soft text-gold-deep" : "bg-shell-200 text-shell-800"}`}>
                  {signal.value}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="absolute left-1/2 top-[60%] z-0 h-64 w-64 -translate-x-1/2 -translate-y-1/2 opacity-95 drop-shadow-[0_30px_50px_rgba(22,74,65,0.22)] sm:h-72 sm:w-72">
        <ShellMark animated className="h-full w-full" />
      </div>

      {bubbles.map((bubble, index) => (
        <span
          key={index}
          className="shell-bubble"
          style={
            {
              "--bubble-left": bubble.left,
              "--bubble-size": `${bubble.size}px`,
              "--bubble-delay": bubble.delay,
              "--bubble-duration": bubble.duration,
            } as CSSProperties
          }
        />
      ))}

      <div className="shell-current shell-current-one" />
      <div className="shell-current shell-current-two" />

      <div className="absolute inset-x-8 bottom-8 z-10 grid gap-3 sm:grid-cols-3">
        {["No verdicts", "Consent first", "Manual review"].map((item) => (
          <div key={item} className="rounded-2xl border border-white/80 bg-white/80 px-3 py-3 text-center text-xs font-bold text-navy backdrop-blur-xl">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
