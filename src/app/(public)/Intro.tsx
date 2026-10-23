"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { PUBLIC_IMAGES } from "./media";
import styles from "./intro.module.css";

/**
 * The opening sequence.
 *
 * Ten seconds of film; a black veil that closes over it; the name, the crest
 * and the mission arriving as the last of the picture goes. Then it holds,
 * composed, until the reader chooses to go on.
 *
 * Holding rather than dissolving is the board's call and it changes the
 * shape of the thing: this is no longer an animation that gets out of the
 * way, it is the first page. Which makes the way out matter more, not less:
 *
 *   1. **It plays when you come through the front door, every time.**
 *      Crossing the threshold is the moment the film belongs to. Moving
 *      around inside the site afterwards is not, so a member going from
 *      Events back to the home page does not sit through it again.
 *   2. **There is always a way on**, by a button that holds focus, by Escape,
 *      by Enter, and by scrolling. A held card with no visible exit is a
 *      dead end, and this one holds indefinitely by design.
 *   3. **It never traps the page.** If the file fails, stalls, or autoplay is
 *      refused, the sequence ends and the page is there. The film is
 *      decoration; the page is the point.
 *
 * Reduced motion skips the whole thing.
 */

/**
 * When the composition is complete. Must match the animation timings.
 *
 * The film is 10s and the veil lands on its final frame; the title, crest
 * and mission follow over the next 3.5s. So the sequence runs past the film,
 * and this is the moment it settles.
 */
const HOLD_AT_MS = 13_700;

/** A stalled video must not hold the page: this is the hard stop. */
const STALL_LIMIT_MS = 18_000;

/**
 * Set by the front door at the moment a door is clicked, and consumed here.
 *
 * A one-shot flag rather than a "seen" flag, because the rule is about where
 * you came from, not how often you have been. `document.referrer` cannot
 * answer this: it does not change on a client-side navigation, which is what
 * a Link performs.
 */
const FROM_DOOR_KEY = "jsoa:from-door";

export function Intro({
  title,
  mission,
  note,
}: {
  /** Fades in at the top. */
  title: string;
  /** Fades in at the foot. One paragraph or several. */
  mission: string[];
  /**
   * A quieter aside beneath the mission, set in parentheses and italics.
   *
   * Wraps naturally rather than being forced onto a single rendered line: at
   * this length that would be unreadable on a phone, and "one line" is about
   * it reading as one continuous aside rather than a second paragraph.
   */
  note?: string;
}) {
  /**
   * Decided during render, not in an effect.
   *
   * An effect runs after the first paint, so the white page was showing for
   * a frame before the black took over. Reading the flag in the initialiser
   * means the sequence is either there on the very first paint or never
   * mounts at all, and there is no flash either way.
   *
   * `window` is absent on the server, where this always renders nothing.
   */
  const [state, setState] = useState<"checking" | "playing" | "held" | "done">(() => {
    if (typeof window === "undefined") return "checking";
    let cameThroughTheDoor = false;
    try {
      cameThroughTheDoor = sessionStorage.getItem(FROM_DOOR_KEY) === "1";
      // Consumed at once: one arrival, one showing, and a refresh replays
      // nothing.
      sessionStorage.removeItem(FROM_DOOR_KEY);
    } catch {
      cameThroughTheDoor = false;
    }
    if (!cameThroughTheDoor) return "done";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "done";
    return "playing";
  });
  const videoRef = useRef<HTMLVideoElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (stallTimer.current) clearTimeout(stallTimer.current);
    setState("done");
  }, []);

  useEffect(() => {
    if (state !== "playing") return;
    holdTimer.current = setTimeout(() => setState("held"), HOLD_AT_MS);
    stallTimer.current = setTimeout(() => setState("held"), STALL_LIMIT_MS);
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      if (stallTimer.current) clearTimeout(stallTimer.current);
    };
    // Runs once: `state` only ever leaves "playing" by the timers below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state !== "playing") return;
    // Autoplay is refused often enough to be a case rather than an error. The
    // veil and the type run on their own timers, so it still reads as
    // deliberate if the picture never moves.
    void videoRef.current?.play().catch(() => {});
  }, [state]);

  useEffect(() => {
    if (state === "done" || state === "checking") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter") dismiss();
    };
    const onWheel = () => dismiss();
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchmove", onWheel, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchmove", onWheel);
    };
  }, [state, dismiss]);

  if (state === "checking" || state === "done") return null;

  return (
    <div
      className={`${styles.intro} ${state === "held" ? styles.held : ""}`}
      role="dialog"
      aria-label="Introduction"
    >
      <video
        ref={videoRef}
        className={styles.video}
        src="/media/jsoa-intro.mp4"
        muted
        playsInline
        autoPlay
        preload="auto"
        aria-hidden="true"
        onError={() => setState("held")}
      />
      <div className={styles.veil} aria-hidden="true" />

      <p className={styles.title}>{title}</p>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={PUBLIC_IMAGES.crest.src} alt="" className={styles.crest} />

      <div className={styles.mission}>
        {mission.map((paragraph) => (
          <p key={paragraph.slice(0, 40)}>{paragraph}</p>
        ))}
        {note ? <p className={styles.note}>({note})</p> : null}
      </div>

      <button type="button" className={styles.skip} onClick={dismiss} autoFocus>
        {state === "held" ? "Enter the site" : "Skip"}
      </button>
    </div>
  );
}
