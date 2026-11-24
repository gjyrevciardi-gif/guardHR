const escapeXml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/**
 * The candidate's own name and e-mail, tiled faintly over the exam. A screenshot or a photo of the screen cannot be
 * prevented in a browser, but one that leaks then says whose it is. Purely visual: it never takes a click or a focus.
 */
export function ExamWatermark({ text }: { text: string }) {
  const label = text.length > 70 ? `${text.slice(0, 69)}…` : text;
  const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="240"><text x="20" y="150" transform="rotate(-20 280 120)" font-family="sans-serif" font-size="15" fill="#64748b" fill-opacity="0.24">${escapeXml(label)}</text></svg>`;
  return <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-20 print:hidden" style={{ backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(tile)}")` }} />;
}
