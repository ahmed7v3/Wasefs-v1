import { BlockList, isIP } from "node:net";

/*
 * IP allow-list of a key: single addresses and CIDR blocks, IPv4 and IPv6. IPv4-mapped IPv6 clients
 * (`::ffff:203.0.113.7`) match IPv4 entries (Node's BlockList does that mapping).
 */

export function parseAllowEntry(
  entry: string,
): { address: string; prefix: number | null; family: 4 | 6 } | null {
  const text = entry.trim();
  const slash = text.indexOf("/");
  const address = slash === -1 ? text : text.slice(0, slash);
  const family = isIP(address);
  if (family === 0) return null;
  if (slash === -1) return { address, prefix: null, family: family as 4 | 6 };
  const prefixText = text.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  if (prefix > (family === 4 ? 32 : 128)) return null;
  return { address, prefix, family: family as 4 | 6 };
}

export function isValidAllowEntry(entry: string): boolean {
  return parseAllowEntry(entry) !== null;
}

/** Entries that do not parse are ignored (they can only narrow access, never widen it). */
export function compileAllowList(entries: readonly string[]): BlockList {
  const list = new BlockList();
  for (const entry of entries) {
    const parsed = parseAllowEntry(entry);
    if (!parsed) continue;
    const type = parsed.family === 4 ? "ipv4" : "ipv6";
    if (parsed.prefix === null) list.addAddress(parsed.address, type);
    else list.addSubnet(parsed.address, parsed.prefix, type);
  }
  return list;
}

/** Empty list = any address. */
export function ipAllowed(ip: string, entries: readonly string[]): boolean {
  if (entries.length === 0) return true;
  const family = isIP(ip);
  if (family === 0) return false;
  return compileAllowList(entries).check(ip, family === 4 ? "ipv4" : "ipv6");
}
