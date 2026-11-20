export function Wordmark({ tone = "dark" }: { tone?: "dark" | "light" }) {
  // One element, so it stays a single item when a parent uses flex gap.
  return (
    <span>
      NemoGuard<span className={tone === "light" ? "text-gold" : "text-gold-text"}>HR</span>
    </span>
  );
}
