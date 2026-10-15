// Mail servers people type in (a school's ticket mailbox, an import from an
// old provider) are dialled by OUR servers. Without a check, an address like
// 169.254.169.254, localhost or a private 10.x host would make them probe our
// own network and report back through the error message (security review,
// 2026-10-15). Only public addresses on the normal mail ports are allowed.

const PORTS = { imap: [993, 143], smtp: [465, 587, 25, 2525] } as const;

const v4Private = (ip: string) => {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
};

const v6Private = (ip: string) => {
  const x = ip.toLowerCase();
  if (x === "::" || x === "::1") return true;
  if (x.startsWith("::ffff:")) return v4Private(x.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x);
};

// Null when the host may be dialled, otherwise a message for the person.
export const checkMailHost = async (hostIn: string, port: number, kind: "imap" | "smtp"): Promise<string | null> => {
  const host = String(hostIn || "").trim().toLowerCase().replace(/\.$/, "");
  if (!(PORTS[kind] as readonly number[]).includes(Number(port))) {
    return `Use a standard ${kind.toUpperCase()} port (${PORTS[kind].join(", ")}).`;
  }
  if (!/^[a-z0-9.-]+$/.test(host) && !/^[0-9a-f:]+$/.test(host)) return "That is not a valid mail server name.";
  if (host === "localhost" || /\.(local|internal|localhost|lan|home)$/.test(host)) return "That mail server is not on the internet.";
  let addresses: string[] = [];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) addresses = [host];
  else if (host.includes(":")) addresses = [host];
  else {
    const [a, aaaa] = await Promise.all([
      Deno.resolveDns(host, "A").catch(() => [] as string[]),
      Deno.resolveDns(host, "AAAA").catch(() => [] as string[]),
    ]);
    addresses = [...a, ...aaaa];
    if (!addresses.length) return "That mail server name could not be found.";
  }
  if (addresses.some((ip) => (ip.includes(":") ? v6Private(ip) : v4Private(ip)))) return "That mail server is not on the internet.";
  return null;
};
