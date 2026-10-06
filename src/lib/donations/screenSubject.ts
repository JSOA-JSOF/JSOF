/**
 * Bridges this module's `?as=` switcher onto the shared board session.
 *
 * The donations screens were built before `@/lib/authz/session` landed, so they
 * read a role from the query string. That produced two switchers disagreeing on
 * one page: the shell header said "President" while the screen said "Not signed
 * in" and refused. Both were correct, which is worse than either being wrong.
 *
 * The shared persona switcher in the board shell is now the authority. An
 * explicit `?as=` still wins, because it is useful for linking someone straight
 * to a particular refusal, and because the module's tests exercise it.
 *
 * Server-only: it reads a cookie.
 */

import "server-only";

import type { Entity } from "../authz/model";
import { getCurrentPersona, subjectFor } from "../authz/session";
import type { Subject } from "../authz/policy";
import { entityFromParam, labelForParam, subjectFromParam } from "./devSubject";

export type ScreenViewer = {
  subject: Subject;
  entity: Entity;
  roleLabel: string;
  /** Query string to carry an explicit override across links; empty otherwise. */
  qs: string;
};

function firstEntityOf(subject: Subject, fallback: Entity): Entity {
  // The Foundation is the natural default for these screens; fall back to it
  // unless the viewer holds nothing there.
  const entities = subject.assignments.map((assignment) => assignment.entity);
  return entities.includes(fallback) ? fallback : (entities[0] ?? fallback);
}

export async function resolveScreenViewer(
  param: string | string[] | undefined,
  fallbackEntity: Entity = "JSOF",
): Promise<ScreenViewer> {
  const explicit = Array.isArray(param) ? param[0] : param;

  if (explicit) {
    return {
      subject: subjectFromParam(explicit),
      entity: entityFromParam(explicit, fallbackEntity),
      roleLabel: labelForParam(explicit),
      qs: `?as=${encodeURIComponent(explicit)}`,
    };
  }

  const persona = await getCurrentPersona();
  const subject = subjectFor(persona);
  return {
    subject,
    entity: firstEntityOf(subject, fallbackEntity),
    roleLabel: persona.label,
    qs: "",
  };
}
