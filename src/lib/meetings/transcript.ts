/**
 * Transcript intake.
 *
 * WHAT THIS IS: a deterministic text parser. It splits a pasted Teams or Zoom
 * transcript into speaker turns, assigns runs of turns to agenda items by
 * keyword overlap with the item titles, and pulls motion, second, vote and
 * recusal language out with regular expressions.
 *
 * WHAT THIS IS NOT: a summary. There is no model call here and none is wanted.
 * The `discussion` field of every section it produces is a VERBATIM EXTRACT of
 * the turns it assigned to that item, truncated at a fixed length. Nothing is
 * paraphrased, condensed or interpreted, because a machine paraphrase of what
 * a board said is a liability dressed as a convenience.
 *
 * Every section it produces is marked `draft: true`, carries
 * `UNREVIEWED_TRANSCRIPT_DRAFT`, and has `DRAFT_MARKER` written into its text.
 * `clearDraftMarkers` refuses to clear a section while any marker survives, so
 * a draft cannot become a minute of record by being ignored.
 *
 * Known limits, stated plainly because the Secretary needs to know where to
 * look rather than trust the output:
 *
 *   - Assignment is keyword overlap, so an item titled "Budget" will collect
 *     every mention of a budget anywhere in the meeting, and an item discussed
 *     without using its title words will collect nothing.
 *   - Segmentation is sequential: once a turn opens an item, following turns
 *     stay with it until another item scores higher. A meeting that jumps back
 *     and forth will be mis-split.
 *   - A speaker the attendee list does not contain is recorded as unmatched,
 *     not guessed at.
 *   - Vote tallies are only read when the transcript states digits or small
 *     number words. "Unanimous", "any objection", and a show of hands produce
 *     no tally, and the section is flagged.
 *   - Motion text is the mover's own words from the motion phrase to the end
 *     of that sentence. It is frequently not the motion as finally amended.
 *   - Recusal reason is the verbatim sentence in which the recusal was stated.
 *     It is a pointer to the passage, not a finding.
 *   - Crosstalk, overlapping speech and anything the platform's own speech
 *     recognition dropped are invisible here.
 */

import type { Role } from "../authz/model";
import type {
  AgendaItem,
  Meeting,
  MinuteEntryInput,
  Motion,
  MotionOutcome,
  Recusal,
  RecusalBasis,
  VoteTally,
} from "./types";

export const DRAFT_MARKER = "[UNREVIEWED DRAFT]";

export const MAX_EXTRACT_CHARS = 2400;

/** Keyword points a turn needs before it can open a new agenda-item section. */
export const HEADING_THRESHOLD = 2;

export const TRANSCRIPT_METHOD_SUMMARY = [
  "Splits the paste into speaker turns (Teams, Zoom, WebVTT and plain `Name: text`).",
  "Scores each turn against keywords derived from each agenda item title, plus any keywords the Secretary added to the item.",
  "Opens a new section when a turn scores at or above the threshold for a different item, or when it says `item 4` outright.",
  "Copies the assigned turns into the section verbatim. It does not summarise them.",
  "Runs motion, second, vote and recusal patterns over the section and reports what matched.",
  "Marks everything it produced as an unreviewed draft.",
] as const;

/* ------------------------------------------------------------------ *
 * Speaker turns
 * ------------------------------------------------------------------ */

export type SpeakerTurn = {
  /** As it appeared in the transcript. */
  speakerLabel: string;
  /** Resolved to an attendee where possible, else null. */
  personId: string | null;
  text: string;
  /** Timecode as written, when the transcript carried one. */
  timecode: string | null;
  /** Position in the transcript, 0-based, after merging consecutive turns. */
  index: number;
};

/**
 * A cue timing line. Teams writes `0:00:04.0 --> 0:00:11.0` with a single
 * fractional digit, Zoom and WebVTT write `00:00:04.000`, and both appear in
 * the wild with a comma for the decimal separator. All three have to match, or
 * the cue line is mistaken for speech and the first real turn loses its
 * speaker.
 */
const VTT_CUE_TIMING =
  /^\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\s*$/;
const VTT_CUE_NUMBER = /^\s*\d{1,5}\s*$/;
const LEADING_TIMECODE = /^\s*[[(]?\s*(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*[\])]?\s+/;
const VTT_VOICE = /^\s*<v\s+([^>]+)>([\s\S]*?)(?:<\/v>)?\s*$/i;
const TRAILING_TAGS = /<\/?[a-z][^>]*>/gi;

/** Teams and Zoom both inject these. They are not speech. */
const NOISE_LINE = new RegExp(
  [
    "^\\s*WEBVTT",
    "^\\s*NOTE\\b",
    "^\\s*Language:",
    "^\\s*Kind:",
    "\\bjoined the meeting\\b",
    "\\bleft the meeting\\b",
    "\\bstarted transcription\\b",
    "\\bstopped transcription\\b",
    "\\bstarted recording\\b",
    "\\bstopped recording\\b",
    "\\bis presenting\\b",
    "\\bstopped presenting\\b",
    "^\\s*\\[?(?:inaudible|crosstalk|silence)\\]?\\s*$",
  ].join("|"),
  "i",
);

/**
 * Words that appear before a colon but are not speakers. Without this,
 * "Motion: ..." in someone's pasted notes becomes a person called Motion.
 */
const NOT_A_SPEAKER = new Set([
  "note",
  "notes",
  "action",
  "actions",
  "motion",
  "seconded",
  "vote",
  "subject",
  "to",
  "from",
  "cc",
  "re",
  "date",
  "attendees",
  "present",
  "apologies",
  "agenda",
  "item",
  "decision",
  "chair",
  "transcript",
  "recording",
  "http",
  "https",
]);

const SPEAKER_NAME = /^([^:\n]{2,60}?)\s*:\s*(.*)$/;

function looksLikeSpeakerName(candidate: string): boolean {
  const trimmed = candidate.trim().replace(/\s*\((?:guest|external|unverified)\)\s*$/i, "");
  if (trimmed.length === 0 || trimmed.length > 60) return false;
  if (NOT_A_SPEAKER.has(trimmed.toLowerCase())) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 5) return false;
  // Every word must look like a name part: letters, hyphen, apostrophe, dot.
  return words.every((word) => /^[A-Za-z][A-Za-z'’.\-]*$/.test(word));
}

function stripTags(text: string): string {
  return text.replace(TRAILING_TAGS, "").trim();
}

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\((?:guest|external|unverified)\)\s*$/i, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve a transcript speaker label to an attendee. Exact normalised match
 * first, then a unique surname match. A surname shared by two attendees
 * resolves to neither: guessing between two board members is worse than
 * admitting the parser could not tell.
 */
export function resolveSpeaker(
  label: string,
  attendees: { personId: string; displayName: string }[],
): string | null {
  const wanted = normaliseName(label);
  if (!wanted) return null;
  const exact = attendees.filter((a) => normaliseName(a.displayName) === wanted);
  if (exact.length === 1) return exact[0].personId;
  const lastWord = wanted.split(" ").slice(-1)[0];
  if (lastWord && lastWord.length >= 3) {
    const bySurname = attendees.filter(
      (a) => normaliseName(a.displayName).split(" ").slice(-1)[0] === lastWord,
    );
    if (bySurname.length === 1) return bySurname[0].personId;
  }
  const firstWord = wanted.split(" ")[0];
  if (firstWord && firstWord.length >= 3 && wanted.split(" ").length === 1) {
    const byFirst = attendees.filter(
      (a) => normaliseName(a.displayName).split(" ")[0] === firstWord,
    );
    if (byFirst.length === 1) return byFirst[0].personId;
  }
  return null;
}

export function parseSpeakerTurns(
  raw: string,
  attendees: { personId: string; displayName: string }[] = [],
): SpeakerTurn[] {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  type Raw = { speakerLabel: string; text: string; timecode: string | null };
  const collected: Raw[] = [];
  let pendingTimecode: string | null = null;
  let current: Raw | null = null;

  const push = () => {
    if (current && current.text.trim().length > 0) collected.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.trim().length === 0) continue;

    const cue = VTT_CUE_TIMING.exec(line);
    if (cue) {
      pendingTimecode = line.trim().split("-->")[0].trim();
      continue;
    }
    if (VTT_CUE_NUMBER.test(line)) continue;
    if (NOISE_LINE.test(line)) continue;

    const voice = VTT_VOICE.exec(line);
    if (voice) {
      push();
      current = {
        speakerLabel: voice[1].trim(),
        text: stripTags(voice[2]),
        timecode: pendingTimecode,
      };
      pendingTimecode = null;
      continue;
    }

    let body = line;
    let timecode = pendingTimecode;
    const lead = LEADING_TIMECODE.exec(body);
    if (lead) {
      timecode = timecode ?? lead[1];
      body = body.slice(lead[0].length);
    }

    const spoken = SPEAKER_NAME.exec(body);
    if (spoken && looksLikeSpeakerName(spoken[1])) {
      push();
      current = {
        speakerLabel: spoken[1].trim(),
        text: stripTags(spoken[2]),
        timecode,
      };
      pendingTimecode = null;
      continue;
    }

    // A continuation line for whoever is speaking, or an unattributed line.
    const continuation = stripTags(body);
    if (continuation.length === 0) continue;
    if (current) {
      current.text = `${current.text} ${continuation}`.trim();
    } else {
      collected.push({ speakerLabel: "", text: continuation, timecode });
    }
    pendingTimecode = null;
  }
  push();

  // Merge consecutive turns by the same speaker. Teams emits one cue per
  // sentence and the item assignment reads much better on whole turns.
  const merged: Raw[] = [];
  for (const turn of collected) {
    const previous = merged[merged.length - 1];
    if (previous && previous.speakerLabel === turn.speakerLabel) {
      previous.text = `${previous.text} ${turn.text}`.trim();
      continue;
    }
    merged.push({ ...turn });
  }

  return merged.map((turn, index) => ({
    speakerLabel: turn.speakerLabel,
    personId: turn.speakerLabel ? resolveSpeaker(turn.speakerLabel, attendees) : null,
    text: turn.text,
    timecode: turn.timecode,
    index,
  }));
}

/* ------------------------------------------------------------------ *
 * Keywords and assignment
 * ------------------------------------------------------------------ */

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "there", "their", "into",
  "about", "report", "update", "review", "item", "items", "board", "meeting",
  "minutes", "discussion", "decision", "information", "request", "new", "old",
  "business", "matters", "arising", "any", "other", "next", "over", "under",
  "chair", "chairs", "annual", "our", "your", "will", "have", "has", "was",
  "were", "been", "note", "notes", "call", "roll", "approve", "approval",
]);

export function keywordsForItem(item: Pick<AgendaItem, "title" | "keywords">): {
  strong: string[];
  weak: string[];
} {
  const strong = (item.keywords ?? [])
    .map((k) => k.toLowerCase().trim())
    .filter((k) => k.length >= 3);
  const weak = item.title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !strong.includes(w));
  return { strong, weak: Array.from(new Set(weak)) };
}

const ORDINAL_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10,
};

/** `item 4`, `agenda item four`, `item number 4`. Returns the item number. */
export function explicitItemCue(text: string): number | null {
  const match =
    /\b(?:agenda\s+)?item\s+(?:number\s+|no\.?\s+|#\s*)?(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.exec(
      text,
    );
  if (!match) return null;
  const token = match[1].toLowerCase();
  const value = /^\d+$/.test(token) ? Number(token) : ORDINAL_WORDS[token];
  return value && value > 0 ? value : null;
}

function containsWord(haystack: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(haystack);
}

export function scoreTurnAgainstItem(
  text: string,
  keywords: { strong: string[]; weak: string[] },
): number {
  let score = 0;
  for (const word of keywords.strong) if (containsWord(text, word)) score += 2;
  for (const word of keywords.weak) if (containsWord(text, word)) score += 1;
  return score;
}

export type Segment = {
  itemId: string;
  itemNumber: number;
  turns: SpeakerTurn[];
  /** How the section was opened, for the Secretary to judge. */
  openedBy: "EXPLICIT_ITEM_CUE" | "KEYWORD_MATCH" | "NEVER_OPENED";
  /** Points the opening turn scored. Zero when never opened. */
  openingScore: number;
};

export function segmentByAgenda(
  turns: SpeakerTurn[],
  items: AgendaItem[],
): { segments: Segment[]; unassigned: SpeakerTurn[] } {
  const ordered = [...items].sort((a, b) => a.position - b.position);
  const keywords = new Map(ordered.map((i) => [i.id, keywordsForItem(i)]));
  const byNumber = new Map(ordered.map((i) => [i.itemNumber, i]));
  const segments = new Map<string, Segment>(
    ordered.map((i) => [
      i.id,
      { itemId: i.id, itemNumber: i.itemNumber, turns: [], openedBy: "NEVER_OPENED", openingScore: 0 },
    ]),
  );
  const unassigned: SpeakerTurn[] = [];

  let currentId: string | null = null;
  let currentIndex = -1;

  for (const turn of turns) {
    // An explicit "item 4" beats every keyword score. Boards say this out loud.
    const cue = explicitItemCue(turn.text);
    const cued = cue !== null ? byNumber.get(cue) : undefined;
    if (cued) {
      currentId = cued.id;
      currentIndex = ordered.findIndex((i) => i.id === cued.id);
      const segment = segments.get(cued.id)!;
      if (segment.openedBy === "NEVER_OPENED") {
        segment.openedBy = "EXPLICIT_ITEM_CUE";
        segment.openingScore = HEADING_THRESHOLD;
      }
      segment.turns.push(turn);
      continue;
    }

    let bestId: string | null = null;
    let bestScore = 0;
    let bestIndex = -1;
    ordered.forEach((item, index) => {
      const score = scoreTurnAgainstItem(turn.text, keywords.get(item.id)!);
      if (score > bestScore) {
        bestScore = score;
        bestId = item.id;
        bestIndex = index;
      }
    });

    // Going back up the agenda needs a stronger signal than moving down it,
    // or a meeting that says "budget" twice flip-flops between two sections.
    const goingBackwards = bestIndex >= 0 && bestIndex < currentIndex;
    const required = goingBackwards ? HEADING_THRESHOLD + 1 : HEADING_THRESHOLD;

    if (bestId && bestId !== currentId && bestScore >= required) {
      currentId = bestId;
      currentIndex = bestIndex;
      const segment = segments.get(bestId)!;
      if (segment.openedBy === "NEVER_OPENED") {
        segment.openedBy = "KEYWORD_MATCH";
        segment.openingScore = bestScore;
      }
    }

    if (currentId) segments.get(currentId)!.turns.push(turn);
    else unassigned.push(turn);
  }

  return {
    segments: ordered.map((i) => segments.get(i.id)!),
    unassigned,
  };
}

/* ------------------------------------------------------------------ *
 * Motion, second, vote
 * ------------------------------------------------------------------ */

const MOVE_PATTERNS: RegExp[] = [
  /\bi(?:'d| would)?\s+(?:like to\s+)?move\s+(?:that|to|we|the)\b/i,
  /\bi\s+hereby\s+move\b/i,
  /\bi\s+make\s+a\s+motion\s+(?:that|to)\b/i,
  /\bi\s+move\b/i,
  /\bmotion\s+to\b/i,
  /\bmove\s+the\s+adoption\s+of\b/i,
];

const SECOND_PATTERNS: RegExp[] = [
  /^\s*(?:i\s+)?second\b/i,
  /\bi(?:'ll| will)?\s+second\b/i,
  /\bseconded\s+by\b/i,
  /\bsecond\s+the\s+motion\b/i,
];

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, none: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

function readCount(token: string | undefined): number | null {
  if (!token) return null;
  const lower = token.toLowerCase();
  if (/^\d+$/.test(lower)) return Number(lower);
  return lower in NUMBER_WORDS ? NUMBER_WORDS[lower] : null;
}

const NUM = "(\\d{1,2}|zero|none|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
const FOR_PATTERN = new RegExp(`${NUM}\\s+(?:votes?\\s+)?(?:in\\s+)?favou?r|${NUM}\\s+(?:votes?\\s+)?for\\b|${NUM}\\s+ayes?\\b`, "i");
const AGAINST_PATTERN = new RegExp(`${NUM}\\s+(?:votes?\\s+)?(?:opposed|against)|${NUM}\\s+nays?\\b`, "i");
const ABSTAIN_PATTERN = new RegExp(`${NUM}\\s+(?:abstentions?|abstaining|abstain)\\b`, "i");

export function readTally(text: string): VoteTally | null {
  const forMatch = FOR_PATTERN.exec(text);
  const againstMatch = AGAINST_PATTERN.exec(text);
  const abstainMatch = ABSTAIN_PATTERN.exec(text);
  const forCount = forMatch ? readCount(forMatch[1] ?? forMatch[2] ?? forMatch[3]) : null;
  if (forCount === null) return null;
  const againstCount = againstMatch
    ? readCount(againstMatch[1] ?? againstMatch[2] ?? againstMatch[3])
    : 0;
  const abstainCount = abstainMatch ? readCount(abstainMatch[1]) : 0;
  return {
    for: forCount,
    against: againstCount ?? 0,
    abstain: abstainCount ?? 0,
  };
}

export function readOutcome(text: string): MotionOutcome | null {
  if (/\bwithdraw(?:s|n|ing)?\b/i.test(text)) return "WITHDRAWN";
  if (/\btabled?\b|\blay(?:ing)?\s+(?:it\s+)?on\s+the\s+table\b|\bdefer(?:red)?\b/i.test(text))
    return "TABLED";
  if (/\b(?:motion\s+)?(?:fails|failed|does not carry|did not carry|is defeated|defeated)\b/i.test(text))
    return "FAILED";
  if (/\b(?:motion\s+)?(?:carries|carried|passes|passed|is adopted|adopted|approved unanimously)\b/i.test(text))
    return "CARRIED";
  return null;
}

/* ------------------------------------------------------------------ *
 * Recusals
 * ------------------------------------------------------------------ */

const RECUSAL_PATTERNS: RegExp[] = [
  /\brecus(?:e|es|ed|ing|al)\b/i,
  /\bconflict(?:ed)?\s+of\s+interest\b/i,
  /\bi\s+(?:have|'ve got)\s+a\s+conflict\b/i,
  /\bi\s+(?:will|'ll|need to|have to|must)\s+(?:step|stand)\s+(?:out|aside|down)\b/i,
  /\b(?:step|stepping|stand|standing)\s+(?:out|aside)\s+(?:for|on)\s+this\b/i,
  /\bi\s+(?:will|'ll|need to|have to|must)\s+(?:leave|drop off)\s+(?:the\s+)?(?:room|call|meeting)\b/i,
  /\bi\s+(?:must|have to|need to)\s+abstain\b/i,
];

const WITHDRAWAL_PATTERNS: RegExp[] = [
  /\b(?:step|stepping|stand|standing)\s+(?:out|aside|down)\b/i,
  /\b(?:leave|leaving|left|drop off|dropping off)\s+(?:the\s+)?(?:room|call|meeting)\b/i,
];

const BASIS_PATTERNS: { basis: RecusalBasis; pattern: RegExp }[] = [
  { basis: "SCHOLARSHIP_CONFLICT", pattern: /\bscholarship|applicant|award\s+to\b/i },
  {
    basis: "INTER_ENTITY_TRANSFER",
    pattern: /\btransfer\b|\binter-?entity\b|\bbetween the (?:two )?(?:entities|organi[sz]ations)\b|\bboth sides\b/i,
  },
  {
    basis: "RELATED_PARTY",
    pattern:
      /\b(?:daughter|son|child|children|spouse|husband|wife|brother|sister|sibling|nephew|niece|cousin|in-?law|stepchild|grandchild|family member|my family)\b/i,
  },
  {
    basis: "EMPLOYMENT",
    pattern: /\b(?:employer|employed|employs|works? for|my firm|my company|my employer|payroll)\b/i,
  },
  {
    basis: "FINANCIAL_INTEREST",
    pattern: /\b(?:financial interest|own(?:s|er|ership)?\b|shareholder|vendor|contractor|supplier|commission|paid by)\b/i,
  },
];

export function inferRecusalBasis(text: string): RecusalBasis {
  for (const { basis, pattern } of BASIS_PATTERNS) {
    if (pattern.test(text)) return basis;
  }
  return "OTHER";
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function firstSentenceMatching(text: string, patterns: RegExp[]): string | null {
  for (const sentence of sentences(text)) {
    if (patterns.some((p) => p.test(sentence))) return sentence;
  }
  return patterns.some((p) => p.test(text)) ? text.trim() : null;
}

/* ------------------------------------------------------------------ *
 * The draft
 * ------------------------------------------------------------------ */

export type DraftSection = {
  itemId: string;
  itemNumber: number;
  itemTitle: string;
  ref: string;
  /** Verbatim extract, marked. Never a paraphrase. */
  discussion: string;
  motion: Motion | null;
  recusals: Recusal[];
  flags: string[];
  /** What the parser did, in the parser's own terms, for the Secretary to check. */
  provenance: {
    openedBy: Segment["openedBy"];
    openingScore: number;
    turnCount: number;
    /** Speaker labels the attendee list did not contain. */
    unmatchedSpeakers: string[];
    truncated: boolean;
  };
};

export type TranscriptDraft = {
  meetingId: string;
  entity: Meeting["entity"];
  /** Total turns parsed out of the paste. */
  turnCount: number;
  /** Turns that matched no agenda item at all. */
  unassignedTurns: SpeakerTurn[];
  /** Speaker labels across the whole transcript that resolved to nobody. */
  unmatchedSpeakers: string[];
  sections: DraftSection[];
  /** Fraction of turns the parser managed to place, 0 to 1. */
  coverage: number;
  /** Item numbers no turn was ever assigned to. */
  itemsWithNothing: number[];
  warnings: string[];
};

export const DRAFT_FLAGS = {
  NOTHING_MATCHED: "TRANSCRIPT_NOTHING_MATCHED",
  NO_MOTION_FOUND: "TRANSCRIPT_NO_MOTION_FOUND",
  MOTION_WITHOUT_SECOND: "TRANSCRIPT_MOTION_WITHOUT_SECOND",
  NO_TALLY_IN_TEXT: "TRANSCRIPT_NO_TALLY_IN_TEXT",
  UNMATCHED_SPEAKER: "TRANSCRIPT_UNMATCHED_SPEAKER",
  TRUNCATED: "TRANSCRIPT_EXTRACT_TRUNCATED",
  WEAK_ASSIGNMENT: "TRANSCRIPT_WEAK_ASSIGNMENT",
  RECUSAL_NEEDS_WORDING: "TRANSCRIPT_RECUSAL_NEEDS_WORDING",
} as const;

export const DRAFT_FLAG_TEXT: Record<string, string> = {
  [DRAFT_FLAGS.NOTHING_MATCHED]:
    "No part of the transcript matched this item. Either it was not reached, or it was discussed without using the words in its title. Write this one from your notes.",
  [DRAFT_FLAGS.NO_MOTION_FOUND]:
    "The parser found no motion language under this item. A decision item needs a motion, so check the passage yourself.",
  [DRAFT_FLAGS.MOTION_WITHOUT_SECOND]:
    "Motion language matched but no second did. Record the seconder, or record that the motion failed for want of a second.",
  [DRAFT_FLAGS.NO_TALLY_IN_TEXT]:
    "The transcript does not state a vote count in numbers. A voice vote or a show of hands leaves nothing to read. Enter the tally from your notes.",
  [DRAFT_FLAGS.UNMATCHED_SPEAKER]:
    "A speaker in this passage is not on the attendee list. Attribution here is not safe to rely on.",
  [DRAFT_FLAGS.TRUNCATED]:
    "The extract was cut at the length limit. The full passage is in the transcript you pasted.",
  [DRAFT_FLAGS.WEAK_ASSIGNMENT]:
    "This item was opened on a single weak keyword hit. The passage may belong somewhere else.",
  [DRAFT_FLAGS.RECUSAL_NEEDS_WORDING]:
    "A recusal was detected and the reason below is the verbatim sentence, not a finding. Rewrite it as the recusal you are recording before you clear this draft.",
};

function extract(turns: SpeakerTurn[]): { text: string; truncated: boolean } {
  const lines = turns.map((turn) => {
    const who = turn.speakerLabel || "Unattributed";
    const when = turn.timecode ? `${turn.timecode} ` : "";
    return `${when}${who}: ${turn.text}`;
  });
  const joined = lines.join("\n");
  if (joined.length <= MAX_EXTRACT_CHARS) return { text: joined, truncated: false };
  return {
    text: `${joined.slice(0, MAX_EXTRACT_CHARS).trimEnd()}\n[extract cut at ${MAX_EXTRACT_CHARS} characters]`,
    truncated: true,
  };
}

function findMotion(
  turns: SpeakerTurn[],
  attendees: { personId: string; displayName: string }[],
): { motion: Motion | null; flags: string[] } {
  const flags: string[] = [];
  const nameFor = (personId: string | null, label: string) =>
    attendees.find((a) => a.personId === personId)?.displayName ?? label;

  const moverIndex = turns.findIndex((t) => MOVE_PATTERNS.some((p) => p.test(t.text)));
  if (moverIndex === -1) return { motion: null, flags: [DRAFT_FLAGS.NO_MOTION_FOUND] };

  const moverTurn = turns[moverIndex];
  const motionText = firstSentenceMatching(moverTurn.text, MOVE_PATTERNS) ?? moverTurn.text;

  // A second normally lands in the next few turns, from someone else.
  const secondTurn =
    turns
      .slice(moverIndex + 1, moverIndex + 6)
      .find(
        (t) =>
          SECOND_PATTERNS.some((p) => p.test(t.text)) &&
          (t.personId === null || t.personId !== moverTurn.personId),
      ) ?? null;
  if (!secondTurn) flags.push(DRAFT_FLAGS.MOTION_WITHOUT_SECOND);

  const after = turns.slice(moverIndex).map((t) => t.text).join(" ");
  const tally = readTally(after);
  if (!tally) flags.push(DRAFT_FLAGS.NO_TALLY_IN_TEXT);

  return {
    motion: {
      text: `${DRAFT_MARKER} verbatim from the mover: ${motionText}`,
      movedByPersonId: moverTurn.personId ?? "",
      movedByName: nameFor(moverTurn.personId, moverTurn.speakerLabel || "unidentified speaker"),
      secondedByPersonId: secondTurn?.personId ?? "",
      secondedByName: secondTurn
        ? nameFor(secondTurn.personId, secondTurn.speakerLabel || "unidentified speaker")
        : "",
      tally,
      outcome: readOutcome(after) ?? "TABLED",
    },
    flags,
  };
}

function findRecusals(
  turns: SpeakerTurn[],
  attendees: { personId: string; displayName: string }[],
): { recusals: Recusal[]; flags: string[] } {
  const recusals: Recusal[] = [];
  const seen = new Set<string>();
  for (const turn of turns) {
    const sentence = firstSentenceMatching(turn.text, RECUSAL_PATTERNS);
    if (!sentence) continue;
    const key = turn.personId ?? turn.speakerLabel;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    recusals.push({
      personId: turn.personId ?? `unmatched:${turn.speakerLabel || `turn-${turn.index}`}`,
      displayName:
        attendees.find((a) => a.personId === turn.personId)?.displayName ??
        (turn.speakerLabel || "unidentified speaker"),
      basis: inferRecusalBasis(sentence),
      reason: `${DRAFT_MARKER} verbatim: "${sentence}"`,
      withdrewFromRoom: WITHDRAWAL_PATTERNS.some((p) => p.test(sentence)),
    });
  }
  return {
    recusals,
    flags: recusals.length > 0 ? [DRAFT_FLAGS.RECUSAL_NEEDS_WORDING] : [],
  };
}

export function draftFromTranscript(args: {
  meeting: Meeting;
  items: AgendaItem[];
  transcript: string;
  refFor: (itemNumber: number) => string;
}): TranscriptDraft {
  const { meeting, items, transcript, refFor } = args;
  const attendees = meeting.attendees;
  const turns = parseSpeakerTurns(transcript, attendees);
  const { segments, unassigned } = segmentByAgenda(turns, items);
  const itemsById = new Map(items.map((i) => [i.id, i]));

  const globalUnmatched = Array.from(
    new Set(
      turns
        .filter((t) => t.speakerLabel && t.personId === null)
        .map((t) => t.speakerLabel),
    ),
  );

  const sections: DraftSection[] = segments.map((segment) => {
    const item = itemsById.get(segment.itemId)!;
    const flags: string[] = [];
    const unmatchedSpeakers = Array.from(
      new Set(
        segment.turns
          .filter((t) => t.speakerLabel && t.personId === null)
          .map((t) => t.speakerLabel),
      ),
    );

    if (segment.turns.length === 0) {
      flags.push(DRAFT_FLAGS.NOTHING_MATCHED);
      return {
        itemId: item.id,
        itemNumber: item.itemNumber,
        itemTitle: item.title,
        ref: refFor(item.itemNumber),
        discussion:
          `${DRAFT_MARKER} No passage of the transcript was assigned to this item. ` +
          `Nothing has been written for you. Record what happened from your notes.`,
        motion: null,
        recusals: [],
        flags,
        provenance: {
          openedBy: segment.openedBy,
          openingScore: segment.openingScore,
          turnCount: 0,
          unmatchedSpeakers: [],
          truncated: false,
        },
      };
    }

    const { text, truncated } = extract(segment.turns);
    if (truncated) flags.push(DRAFT_FLAGS.TRUNCATED);
    if (segment.openedBy === "KEYWORD_MATCH" && segment.openingScore <= HEADING_THRESHOLD) {
      flags.push(DRAFT_FLAGS.WEAK_ASSIGNMENT);
    }
    if (unmatchedSpeakers.length > 0) flags.push(DRAFT_FLAGS.UNMATCHED_SPEAKER);

    const { motion, flags: motionFlags } = findMotion(segment.turns, attendees);
    const { recusals, flags: recusalFlags } = findRecusals(segment.turns, attendees);

    // Motion language is only reported as missing where a motion was expected.
    for (const flag of motionFlags) {
      if (flag === DRAFT_FLAGS.NO_MOTION_FOUND && item.type !== "DECISION") continue;
      flags.push(flag);
    }
    flags.push(...recusalFlags);

    return {
      itemId: item.id,
      itemNumber: item.itemNumber,
      itemTitle: item.title,
      ref: refFor(item.itemNumber),
      discussion:
        `${DRAFT_MARKER} Verbatim extract of the turns assigned to this item. ` +
        `This is not a summary and nothing here has been reviewed.\n\n${text}`,
      motion,
      recusals,
      flags,
      provenance: {
        openedBy: segment.openedBy,
        openingScore: segment.openingScore,
        turnCount: segment.turns.length,
        unmatchedSpeakers,
        truncated,
      },
    };
  });

  const assignedTurns = turns.length - unassigned.length;
  const warnings: string[] = [];
  if (turns.length === 0) {
    warnings.push(
      "No speaker turns were found. The parser expects lines of the form " +
        "`Name: what they said`, a Teams transcript, or a WebVTT file.",
    );
  }
  if (turns.length > 0 && assignedTurns / turns.length < 0.5) {
    warnings.push(
      `Less than half the transcript matched an agenda item ` +
        `(${assignedTurns} of ${turns.length} turns). Add keywords to the agenda ` +
        `items and run it again, or write the minutes from your notes.`,
    );
  }
  if (globalUnmatched.length > 0) {
    warnings.push(
      `These speakers are not on the attendee list, so nothing is attributed to ` +
        `them: ${globalUnmatched.join(", ")}.`,
    );
  }

  return {
    meetingId: meeting.id,
    entity: meeting.entity,
    turnCount: turns.length,
    unassignedTurns: unassigned,
    unmatchedSpeakers: globalUnmatched,
    sections,
    coverage: turns.length === 0 ? 0 : assignedTurns / turns.length,
    itemsWithNothing: sections
      .filter((s) => s.provenance.turnCount === 0)
      .map((s) => s.itemNumber),
    warnings,
  };
}

/**
 * Turn draft sections into repository inputs. Entity comes from the meeting,
 * never from the transcript: a machine may not decide which board was sitting.
 */
export function draftToMinuteInputs(
  draft: TranscriptDraft,
  meeting: Meeting,
): MinuteEntryInput[] {
  return draft.sections.map((section) => ({
    meetingId: meeting.id,
    entity: meeting.entity,
    agendaItemId: section.itemId,
    discussion: section.discussion,
    motion: section.motion,
    recusals: section.recusals,
    closed: false,
    draft: true,
    source: "TRANSCRIPT_DRAFT" as const,
    flags: section.flags,
  }));
}

/** True while any field still carries the marker the parser wrote into it. */
export function stillMarkedDraft(entry: {
  discussion: string;
  motion: Motion | null;
  recusals: Recusal[];
}): boolean {
  if (entry.discussion.includes(DRAFT_MARKER)) return true;
  if (entry.motion?.text.includes(DRAFT_MARKER)) return true;
  return entry.recusals.some((r) => r.reason.includes(DRAFT_MARKER));
}

export type RoleLabel = { role: Role; label: string };
