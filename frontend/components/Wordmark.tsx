export function Wordmark({ tone = "dark" }: { tone?: "dark" | "light" }) {
  return (
    <>
      NemoGuard<span className={tone === "light" ? "text-gold" : "text-gold-text"}>HR</span>
    </>
  );
}
