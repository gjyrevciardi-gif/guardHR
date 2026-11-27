/** The addresses typed into the invited-list box: one per line, or separated by commas, semicolons or spaces. Lower case; the API drops repeats. */
export function parseInvited(text: string): string[] {
  return text.split(/[\s,;]+/).map((entry) => entry.toLowerCase()).filter(Boolean);
}

/** The first entry that cannot be an address, so the host hears it before the server has to refuse the whole form. */
export function firstBadAddress(addresses: string[]): string | undefined {
  return addresses.find((address) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address));
}
