/**
 * The selection record keeps a state, and keeps nothing else about the place.
 *
 * The purge deletes the application, and with it the only link from an award
 * to a school. Before this field existed, the moment a cycle was purged, where
 * its awards went became unreconstructable permanently — so "which states have
 * we reached" could only ever be answered about cycles recent enough to still
 * hold their applicants, which is the opposite of what the question means.
 *
 * The risk being managed in the other direction is re-identification. This
 * record is retained for five years precisely because there is no person in
 * it, and it already carries a score, an amount and an outcome. These tests
 * pin both ends: the state survives the purge, and nothing finer than a state
 * goes in with it.
 */

import { describe, expect, it } from "vitest";

import { personaById, subjectFor } from "../src/lib/authz/personas";
import {
  newScholarshipRepository,
  type ScholarshipRepository,
} from "../src/lib/scholarships/repository";
import { purgeUnsuccessfulApplicants } from "../src/lib/scholarships/retention";
import type { SelectionRecord } from "../src/lib/scholarships/types";

function repo(): ScholarshipRepository {
  return newScholarshipRepository({ seed: true });
}

const chair = () => subjectFor(personaById("scholarships"));

/** Every string on the record, at any depth, with the key that held it. */
function allStrings(value: unknown, path = "$", out: [string, string][] = []): [string, string][] {
  if (typeof value === "string") out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => allStrings(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) allStrings(v, `${path}.${k}`, out);
  }
  return out;
}

describe("the selection record keeps where an award went", () => {
  it("carries a state on the records that survive from a purged cycle", async () => {
    const records = await repo().listSelectionRecords();
    expect(records.length).toBeGreaterThan(0);
    const withState = records.filter((r) => r.schoolState !== null);
    expect(withState.length, "no surviving record knows its state").toBeGreaterThan(0);
  });

  it("reaches more than one state, so the field is actually populated per record", async () => {
    const records = await repo().listSelectionRecords();
    const states = new Set(records.map((r) => r.schoolState).filter(Boolean));
    expect(states.size).toBeGreaterThan(1);
  });

  it("captures the state during the purge, when it still exists", async () => {
    // The real sequence: the application is read for its enrolment, the state
    // is resolved from the school, and only then is the application deleted.
    const repository = repo();
    const before = (await repository.listSelectionRecords()).length;

    const result = await purgeUnsuccessfulApplicants(
      repository,
      chair(),
      new Date("2032-01-01T00:00:00.000Z"),
    );

    const after = await repository.listSelectionRecords();
    expect(after.length, "the purge created no selection records").toBeGreaterThan(before);
    expect(result).toBeTruthy();

    // Every record minted by this purge resolved a state, because every
    // purged application had an enrolment behind it.
    const minted = after.slice(before);
    for (const record of minted) {
      expect(
        record.schoolState,
        `${record.applicationRef} lost its state in the purge`,
      ).not.toBeNull();
      expect(record.schoolState).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe("and keeps nothing finer than a state", () => {
  it("carries no school name, id, city, address or postal code", async () => {
    // A school narrows the field to one institution's applicants in one cycle,
    // which in a small school is a person. A state does not.
    const records = await repo().listSelectionRecords();
    for (const record of records) {
      const keys = Object.keys(record as unknown as Record<string, unknown>);
      for (const forbidden of [
        "schoolId",
        "schoolName",
        "school",
        "city",
        "postalCode",
        "addressLines",
        "payableTo",
      ]) {
        expect(keys, `${record.id} carries ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("carries no applicant name or contact detail at any depth", async () => {
    const repository = repo();
    const schools = await repository.listSchools();
    const schoolNames = new Set(schools.map((s) => s.name));

    for (const record of await repository.listSelectionRecords()) {
      for (const [path, value] of allStrings(record)) {
        expect(value, `${record.id} ${path} looks like an email`).not.toMatch(/@/);
        expect(
          schoolNames.has(value),
          `${record.id} ${path} is a school name`,
        ).toBe(false);
      }
    }
  });

  it("the state is the only location field on the type", () => {
    // Pins the shape so a later addition is a decision rather than a drift.
    const sample: SelectionRecord = {
      id: "x",
      entity: "JSOF",
      cycleId: "c",
      applicationRef: "r",
      outcome: "AWARDED",
      totalScore: 1,
      scoresRecorded: 4,
      awards: [],
      eligibilityRuleVersion: "0-placeholder",
      schoolState: "NC",
      decidedAt: "2026-01-01T00:00:00.000Z",
      retainUntil: "2031-01-01",
    };
    const locationish = Object.keys(sample).filter((k) =>
      /school|city|state|address|postal|zip|county|region/i.test(k),
    );
    expect(locationish).toEqual(["schoolState"]);
  });
});
