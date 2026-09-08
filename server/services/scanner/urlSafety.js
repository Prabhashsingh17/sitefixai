/**
 * urlSafety.js
 * ---------------------------------------------------------------------------
 * URL validation and SSRF (server-side request forgery) protection.
 *
 * Two layers of defense:
 *   1. validateUrlInput()  — cheap, synchronous checks on the URL itself
 *      (scheme, shape, credentials, blocked hostnames/ports) before any
 *      network activity happens.
 *   2. resolveAndPin()     — resolves DNS ourselves and rejects any target
 *      that resolves to a private/loopback/link-local/reserved address,
 *      then returns a single pinned IP for the caller to connect to
 *      directly (via a custom `lookup` option), so the OS/DNS can't hand
 *      back a different, unsafe address between the check and the actual
 *      connection (DNS-rebinding style attacks).
 * ---------------------------------------------------------------------------
 */

const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');
const { InvalidUrlError, BlockedTargetError } = require('./errors');

const MAX_URL_LENGTH = 2048;

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// Hostnames that are always rejected outright, regardless of DNS resolution.
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  '[::1]',
  '::1',
  'metadata.google.internal', // GCP metadata service
]);
const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.local', '.internal'];

// Ports commonly associated with internal-only services. Blocked even when
// the target IP is otherwise public, as extra defense-in-depth.
const BLOCKED_PORTS = new Set([22, 23, 25, 445, 3306, 3389, 5432, 6379, 11211, 27017]);

const BLOCKED_IPV4_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16', // includes 169.254.169.254 cloud metadata
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '255.255.255.255/32',
];

function ipv4ToInt(ip) {
  return (
    ip
      .split('.')
      .reduce((acc, octet) => (acc << 8) + (parseInt(octet, 10) & 0xff), 0) >>> 0
  );
}

function isIpv4InCidr(ip, cidr) {
  const [range, bitsStr] = cidr.split('/');
  const bits = parseInt(bitsStr, 10);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
}

function isPrivateIPv4(ip) {
  return BLOCKED_IPV4_CIDRS.some((cidr) => isIpv4InCidr(ip, cidr));
}

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;

  // fe80::/10 (link-local) through feff (also covers the deprecated but
  // still-reserved fec0::/10 "site-local" range) -- i.e. any address whose
  // first group is fe80-feff. Checked by value, not by a narrow literal
  // prefix, since e.g. "fe90::1" and "febf::1" are valid addresses in this
  // range that a literal "fe80:" prefix check would miss.
  const firstGroup = lower.match(/^([0-9a-f]{1,4}):/);
  if (firstGroup) {
    const groupValue = parseInt(firstGroup[1], 16);
    if (groupValue >= 0xfe80 && groupValue <= 0xfeff) return true;
  }

  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // fc00::/7 unique local

  // IPv4-mapped addresses (::ffff:0:0/96). These can appear in two text
  // forms: dotted-decimal ("::ffff:127.0.0.1") or pure hex groups
  // ("::ffff:7f00:1") -- the latter is what Node/WHATWG's own URL host
  // parser actually normalizes bracketed IPv6 literals to, so both must be
  // checked or a private IPv4 wrapped this way sails straight through.
  const mappedDotted = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedDotted) return isPrivateIPv4(mappedDotted[1]);

  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    const embeddedIpv4 = [(hi >>> 8) & 0xff, hi & 0xff, (lo >>> 8) & 0xff, lo & 0xff].join('.');
    return isPrivateIPv4(embeddedIpv4);
  }

  return false;
}

function assertPublicIp(address) {
  const family = net.isIP(address);
  if (family === 4 && isPrivateIPv4(address)) throw new BlockedTargetError();
  if (family === 6 && isPrivateIPv6(address)) throw new BlockedTargetError();
  if (!family) throw new InvalidUrlError('Invalid IP address encountered while resolving this URL.');
}

/**
 * Synchronous, pre-network validation of a URL string.
 * @param {string} rawUrl
 * @returns {URL}
 * @throws {InvalidUrlError|BlockedTargetError}
 */
function validateUrlInput(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new InvalidUrlError();
  }
  const trimmed = rawUrl.trim();
  if (trimmed.length > MAX_URL_LENGTH) {
    throw new InvalidUrlError('This URL is too long.');
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    throw new InvalidUrlError();
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new InvalidUrlError('Only http:// and https:// URLs are supported.');
  }

  if (parsed.username || parsed.password) {
    throw new InvalidUrlError('URLs with embedded credentials are not supported.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new BlockedTargetError();
  }

  if (parsed.port) {
    const portNum = Number(parsed.port);
    if (BLOCKED_PORTS.has(portNum)) {
      throw new BlockedTargetError();
    }
  }

  // If the hostname is itself a literal IP, validate it immediately.
  if (net.isIP(hostname.replace(/^\[|\]$/g, ''))) {
    assertPublicIp(hostname.replace(/^\[|\]$/g, ''));
  }

  return parsed;
}

/**
 * Resolves a hostname's DNS records and rejects the request if any resolved
 * address is private/loopback/link-local/reserved. Returns the address to
 * pin the actual connection to.
 *
 * @param {string} hostname
 * @returns {Promise<{ address: string, family: 4 | 6 }>}
 * @throws {InvalidUrlError|BlockedTargetError}
 */
async function resolveAndPin(hostname) {
  const bareHost = hostname.replace(/^\[|\]$/g, '');

  const literalFamily = net.isIP(bareHost);
  if (literalFamily) {
    assertPublicIp(bareHost);
    return { address: bareHost, family: literalFamily };
  }

  let records;
  try {
    records = await dns.lookup(bareHost, { all: true, verbatim: true });
  } catch (err) {
    throw new InvalidUrlError('Could not resolve this domain name.');
  }

  if (!records || records.length === 0) {
    throw new InvalidUrlError('Could not resolve this domain name.');
  }

  // Reject the whole request if ANY resolved address is private -- a
  // stricter stance that also covers multi-answer DNS-rebinding attempts.
  records.forEach((record) => assertPublicIp(record.address));

  return { address: records[0].address, family: records[0].family };
}

module.exports = {
  validateUrlInput,
  resolveAndPin,
  isPrivateIPv4,
  isPrivateIPv6,
};
