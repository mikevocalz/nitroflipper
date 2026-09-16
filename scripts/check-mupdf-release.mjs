#!/usr/bin/env node
//
// Check whether Artifex has published a MuPDF release newer than the one
// third_party/mupdf/CMakeLists.txt pins, and whether the security page has
// changed since the last recorded digest.
//
//   node scripts/check-mupdf-release.mjs [--baseline <file>]
//
// Writes a JSON report to stdout and, when GITHUB_OUTPUT is set, the fields
// the workflow branches on.
//
// What it deliberately does NOT do: download a tarball, compute a new hash, or
// edit the CMake file. An update to MuPDF changes which AGPL-licensed code we
// compile into every consumer's app and can remove API the engine calls, so it
// arrives as a reviewed version+hash bump that reruns the fixtures and the
// native gates. See docs/mupdf-update.md.

import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HISTORY_URL = 'https://mupdf.com/releases/history';
const SECURITY_URL = 'https://mupdf.com/security';

const args = process.argv.slice(2);
const baselineIndex = args.indexOf('--baseline');
const baselinePath =
  baselineIndex === -1
    ? resolve(PACKAGE_ROOT, '.github/mupdf-security-baseline.txt')
    : resolve(args[baselineIndex + 1]);

// --- the pin -----------------------------------------------------------------

function readPin() {
  const cmake = readFileSync(
    resolve(PACKAGE_ROOT, 'third_party/mupdf/CMakeLists.txt'),
    'utf8'
  );
  // MUPDF_URL_SHA256's value is on the line after the set(), so match across
  // newlines rather than per line.
  const pick = (name) => {
    const m = cmake.match(new RegExp(`set\\(\\s*${name}\\s+"([^"]+)"`));
    if (!m) throw new Error(`${name} not found in third_party/mupdf/CMakeLists.txt`);
    return m[1];
  };
  return {
    version: pick('MUPDF_VERSION'),
    sha256: pick('MUPDF_URL_SHA256'),
    tag: pick('MUPDF_UPSTREAM_TAG'),
  };
}

// --- fetching ----------------------------------------------------------------

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'nitro-flipper mupdf release check' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res.text();
}

function toPlainText(html) {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- version comparison ------------------------------------------------------

const parseVersion = (v) => v.split('.').map(Number);

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// The history page lists every release as a plain `1.28.4`-shaped string. Only
// three-component versions are taken: two-component matches on that page are
// CSS lengths and line heights, not releases.
function extractVersions(html) {
  const found = new Set();
  for (const m of html.matchAll(/\b(\d+\.\d+\.\d+)\b/g)) {
    const v = m[1];
    // MuPDF's whole published history is 0.x and 1.x. Anything else on the
    // page is a library version, a date fragment or a stylesheet number.
    const major = Number(v.split('.')[0]);
    if (major === 0 || major === 1) found.add(v);
  }
  return [...found].sort(compareVersions);
}

// --- main --------------------------------------------------------------------

const pin = readPin();

const [historyHtml, securityHtml] = await Promise.all([
  fetchText(HISTORY_URL),
  fetchText(SECURITY_URL),
]);

const versions = extractVersions(historyHtml);
if (versions.length === 0) {
  // A silent "no newer release" because the page changed shape is the one
  // failure mode this check must not have.
  console.error(
    `error: parsed no versions out of ${HISTORY_URL}. The page layout probably ` +
      `changed and this script needs updating.`
  );
  process.exit(1);
}

const latest = versions[versions.length - 1];
const newer = versions.filter((v) => compareVersions(v, pin.version) > 0);
const pinnedStillListed = versions.includes(pin.version);

const securityText = toPlainText(securityHtml);
const securityDigest = createHash('sha256').update(securityText).digest('hex');
const previousDigest = existsSync(baselinePath)
  ? readFileSync(baselinePath, 'utf8').trim()
  : null;

const report = {
  checkedAt: new Date().toISOString(),
  pinned: pin,
  history: {
    url: HISTORY_URL,
    latest,
    pinnedStillListed,
    newerVersions: newer,
    releasesParsed: versions.length,
  },
  security: {
    url: SECURITY_URL,
    digest: securityDigest,
    previousDigest,
    changed: previousDigest !== null && previousDigest !== securityDigest,
    baselineRecorded: previousDigest !== null,
    mentionsPinnedVersion: securityText.includes(pin.version),
    cves: [...new Set(securityText.match(/CVE-\d{4}-\d{4,7}/gi) ?? [])],
  },
};

report.actionNeeded =
  newer.length > 0 || report.security.changed || report.security.cves.length > 0;

console.log(JSON.stringify(report, null, 2));

if (process.env.GITHUB_OUTPUT) {
  const out = [
    `action_needed=${report.actionNeeded}`,
    `pinned_version=${pin.version}`,
    `latest_version=${latest}`,
    `newer_versions=${newer.join(', ')}`,
    `security_changed=${report.security.changed}`,
    `security_digest=${securityDigest}`,
    `cves=${report.security.cves.join(', ')}`,
  ].join('\n');
  appendFileSync(process.env.GITHUB_OUTPUT, out + '\n');
}

// Not finding the pinned version on the history page means the pin points at
// something Artifex no longer lists. That is worth a loud failure rather than
// a quiet report.
if (!pinnedStillListed) {
  console.error(
    `error: pinned MuPDF ${pin.version} is not listed on ${HISTORY_URL}. ` +
      `Either the page changed shape or the release was withdrawn.`
  );
  process.exit(1);
}
