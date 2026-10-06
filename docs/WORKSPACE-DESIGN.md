# The Scholarships Chair's workspace: design notes

What this is for, and the reasoning behind each decision, so a later change
knows what it is changing.

## The person

One volunteer. 150 applications, 183 awards, about 40 hours a month from
January to June and 3 the rest of the year. She does this around a life, in
bursts, on a personal laptop. The two tasks she named as most draining are not
the judgement calls — they are emailing each student their award amount, and
mailing cheques to schools.

The applicants are dependents of JSOC families. Some applications turn on a
Purple Heart or a disability rating. This is not a ticket queue.

## What "psychological design" means here, and what it does not

It means designing around how attention, fatigue and memory actually behave, to
reduce her load. It does **not** mean persuasion mechanics. There is a real fork
here and this file takes the humane side of it deliberately:

- Progress is always **honest**. No endowed-progress trick, no bar that starts
  at 15% to manufacture momentum. If she has done 47 of 150, it says 47 of 150.
- **No gamification.** No streaks, no badges, no confetti, no celebratory
  animation. This organization memorializes the fallen. Reward mechanics
  borrowed from consumer apps would be grotesque here, and would also imply the
  work is a game when it is a duty.
- **No urgency manufacturing.** Real deadlines are shown; invented ones are not.
- Defaults exist to remove repetition, and are always **visible and
  overridable**. A default that hides what it decided is a dark pattern.

## The decisions

### 1. Resumption cost is the real enemy

Volunteer work happens in bursts, and the hardest moment is not the work — it
is restarting after four days away. So the workspace opens on one sentence
naming the next action and the exact position: "Pick up where you left off —
application 48 of 150." No dashboard to re-read, no re-orientation, no hunting
for where she stopped. State is held so the queue resumes precisely.

### 2. One decision at a time

A list of 150 is a wall; a queue of one is a task. The review screen shows a
single application with everything needed to score it and nothing else.
Chunking cuts perceived load far more than any layout change.

### 3. Progress, shown honestly, because of the goal gradient

People accelerate measurably as they approach a finish line. A truthful
remaining-count is therefore worth showing on every screen — and it is the one
place where accuracy matters most, since an inflated bar would spend her trust
to buy a few minutes of momentum.

### 4. Decision fatigue is real, and the humane response is self-knowledge

Scoring consistency degrades over a long session: late applications tend to be
scored harder or softer than early ones by the same person. Two responses, both
informational rather than nagging:

- A **session meter**: how many she has scored in this sitting.
- A **drift indicator**: her running average this session against her average
  across the cycle. If she has drifted half a point harsh over the last twenty,
  she can see it and decide what to do. The system never adjusts her scores.

After a long run it offers a pause, once, and does not repeat.

### 5. Fear of irreversible error deserves a real answer

183 messages about money, to real families, sent by a volunteer at 11pm. The
answer is not a confirmation dialog, which people click through. It is a
**persistent not-yet-sent state**: awards accumulate as drafts, the workspace
says plainly that nothing has gone out, and sending is a separate deliberate act
that states exactly what will happen and to whom before it happens.

### 6. Defaults that collapse 119 decisions into a few

Award banding turns a score into a default amount. That converts 119 individual
money decisions into a handful of band decisions plus the exceptions worth
attention. The band is always shown next to the amount, and overriding it is one
field, not a workflow.

Exceptions surface rather than hide: board members' dependents, and applicants
sitting exactly on a band boundary where a half point changes the money.

### 7. The end of the cycle should land as an ending

The peak-end rule says an experience is remembered by its most intense moment
and its end. The end of a scholarship cycle is currently a queue going empty.
It should instead state what was actually done — the number of students, the
total awarded, the schools paid — because that is the thing she has been doing
40 hours a month for, and it is otherwise never said out loud.

### 8. Register

Applicants are named, not numbered, on her screens. The language is plain and
institutional. The restraint already in the design system is correct and this
workspace does not depart from it.

## What this costs if ignored

The failure mode is not an ugly screen. It is a volunteer who opens the tool,
cannot remember where she was, closes it, and does the cycle in Submittable and
a spreadsheet for another year.
