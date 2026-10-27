#!/usr/bin/env node
/**
 * The dependency advisory gate.
 *
 * `npm audit` on its own is not usable as a gate here: it is red today,
 * for a transitive advisory whose only fix is a major version bump of
 * Next. The two usual responses are both bad. Running it with `|| true`
 * produces a check nobody reads. Blocking on it produces a check
 * everybody bypasses, and a gate people route around is worse than no
 * gate, because it also teaches them that bypassing is normal.
 *
 * So anything unknown fails, and a known advisory passes only while
 * somebody has written down why and until a date they chose. An expired
 * waiver fails exactly like an unknown advisory, which is the point:
 * the decision to live with something has to be re-made rather than
 * inherited.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const waivers = JSON.parse(readFileSync(join(root, "security/waivers.json"), "utf8"));

let report;
try {
  report = JSON.parse(
    execFileSync("npm", ["audit", "--omit=dev", "--json"], {
      cwd: root,
      encoding: "utf8",
      // npm exits non-zero when it finds anything, which is not an error here.
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
} catch (error) {
  if (!error.stdout) {
    console.error("could not run npm audit");
    process.exit(2);
  }
  report = JSON.parse(error.stdout);
}

const BLOCK_AT = new Set(["high", "critical"]);
const today = new Date().toISOString().slice(0, 10);

const problems = [];
const allowed = [];

for (const [name, detail] of Object.entries(report.vulnerabilities ?? {})) {
  if (!BLOCK_AT.has(detail.severity)) continue;
  const waiver = waivers.advisories.find((w) => w.package === name);
  if (!waiver) {
    problems.push(`${name} (${detail.severity}) has no waiver`);
    continue;
  }
  if (waiver.until < today) {
    problems.push(
      `${name} (${detail.severity}) was waived until ${waiver.until}, which has passed`,
    );
    continue;
  }
  allowed.push(`${name} waived until ${waiver.until}: ${waiver.because}`);
}

// A waiver for something that no longer appears is worth removing, but
// it is not a reason to fail a build.
for (const waiver of waivers.advisories) {
  if (!report.vulnerabilities?.[waiver.package]) {
    console.log(`note: waiver for ${waiver.package} is no longer needed`);
  }
}

for (const line of allowed) console.log(`allowed: ${line}`);

if (problems.length > 0) {
  console.error("\nadvisory gate failed:");
  for (const line of problems) console.error(`  ${line}`);
  console.error(
    "\nFix it, or add a dated entry to security/waivers.json saying why " +
      "it is acceptable and when that decision expires.",
  );
  process.exit(1);
}

console.log(`advisory gate passed (${report.metadata.vulnerabilities.total} total advisories)`);
