// Comparison keys for "is this the same business?". Kept in their own module, importing
// nothing, because client components need them too: lib/leads.ts pulls in the Postgres
// client at module level, and importing from it in the browser would ship the driver.

/**
 * Normalise a website into a comparison key: strip protocol, `www.`, path and trailing
 * slash. `https://www.Example.com/about` and `example.com` are the same business.
 */
export function siteKey(site: unknown): string {
  return String(site ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0]
    .replace(/\.$/, '')
}

/**
 * Normalise a company name: lowercase, drop legal suffixes and punctuation, collapse
 * whitespace. "KeyChoc Ltd." and "Keychoc Limited" should not both enter the pipeline.
 */
export function companyKey(name: unknown): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\b(ltd|limited|inc|incorporated|llc|llp|plc|corp|corporation|co|company|gmbh|pty|pte|bv|nv|sa|ag|kk)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}
