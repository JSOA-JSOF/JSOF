-- The three routing answers, and the disability evidence as columns.
--
-- Both gaps were mine, found by the scholarships port rather than by
-- me, and the first one is the kind that would have shipped quietly.
--
-- 0007 stored the routing OUTCOME and the explanation but not the
-- ANSWERS that produced them. That looked harmless, because an outcome
-- is what a reader wants. It is not harmless: routing.ts line 145
-- computes which programmes a person may apply for from
-- `answers.applyingForWoundedPatriot`, and the intake builds its steps
-- from that. With no column the answer has to be reconstructed, and
-- the only thing available to reconstruct it from is whether a
-- wounded-patriot section exists -- which is circular, because that
-- section is only created once the step appears. The result is that
-- the Wounded Patriot intake path never appears at all. Nothing throws.
--
-- The lesson worth keeping: storing a decision and discarding its
-- inputs is fine right up until something downstream recomputes from
-- the inputs.

ALTER TABLE scholarship_application ADD COLUMN routing_nc_resident INTEGER;
ALTER TABLE scholarship_application ADD COLUMN routing_attending_nc_school INTEGER;
ALTER TABLE scholarship_application ADD COLUMN routing_applying_wounded_patriot INTEGER;

-- Nullable on purpose, and not defaulted to 0. Null means "this
-- application predates the columns and nobody answered", which is a
-- different thing from "they answered no". A default would have made
-- every historical row assert an answer it never gave.

-- Disability evidence, as its three fields.
--
-- 0007 gave it one TEXT column and the port JSON-encoded three fields
-- into it, which is the reasonable thing to do with the schema it was
-- handed. Three columns are better here for a reason specific to this
-- table: `verification_contact` is a person the chair may ring, and a
-- name buried in a JSON blob is a name nobody can find when a
-- retention sweep needs to remove it.
--
-- What is NOT stored is unchanged and is the point: the applicant's
-- own account, what they say the connection to service is, and who may
-- confirm it. Never a document, never an attachment, never a
-- diagnosis.
ALTER TABLE scholarship_wounded_patriot ADD COLUMN evidence_narrative TEXT NOT NULL DEFAULT '';
ALTER TABLE scholarship_wounded_patriot ADD COLUMN evidence_service_connection TEXT NOT NULL DEFAULT '';
ALTER TABLE scholarship_wounded_patriot ADD COLUMN evidence_verification_contact TEXT NOT NULL DEFAULT '';
