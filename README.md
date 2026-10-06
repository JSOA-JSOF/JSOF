# JSOA / JSOF Platform

One platform serving two legal entities: the Joint Special Operations Association
(JSOA, a 501(c)(19) membership association) and the Joint Special Operations
Foundation (JSOF, a 501(c)(3) that administers scholarships). They share a
volunteer board; they do not share a ledger, a donor record, or a receipt.

**Status: demo build.** No real member data until the security pass is complete.

Start with `docs/ARCHITECTURE.md`. It is the spec every module is built against,
and it is binding on module work: if a module needs to depart from it, change the
spec first.

## Non-negotiables

1. Every record carries an entity tag. No screen shows a blended total unlabelled.
2. Permissions are granted per data class per entity, never per screen.
3. No role holds write on both FINANCIAL and APPLICANT for the same entity.
4. No actor can approve a transaction it created. Self-approval is an error.
5. Publishing anything with a person's name, unit, or face needs a second, different approver.
6. The audit log is append-only. Nobody can delete from it, including the President.
7. The platform never stores or displays a third-party credential. Those live in Proton Pass.

## Layout

    docs/            the spec and per-module briefs
    prisma/          data model
    src/lib/authz/   data classes, roles, the permission matrix, the invariants
    src/lib/         module logic
    tests/           control tests: the ones that try to break the rules
