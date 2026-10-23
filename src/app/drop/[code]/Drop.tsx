"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  ACCEPTED_TYPES,
  RESIZE_MAX_EDGE,
  dropIsOpen,
  type Drop as DropConfig,
} from "@/lib/drop/config";

import styles from "./drop.module.css";

/**
 * The thing somebody sees after scanning the code.
 *
 * Two rules decided everything here.
 *
 * The first is the film, then the uploader, in that order, and nothing on
 * top of the film. It sits at the full width of the phone at its own
 * shape, so no part of the frame is cropped away and no caption covers
 * what somebody scanned a code to watch. The only thing under it is the
 * button.
 *
 * That button is not a gate. It is on screen from the first paint, before
 * the video has loaded a frame, so a refused autoplay, a slow connection
 * or data saver still leaves somebody one tap from the uploader. A ten
 * second clip that has to finish before the page works is a ten second
 * clip that loses submissions.
 *
 * The second is that a phone at a golf course is the worst network in the
 * world. So the browser resizes every photograph before it leaves the
 * handset, each one goes up in its own request, two at a time, and a
 * failure retries once and then says so on that row rather than failing the
 * batch. Nothing is lost by closing the page: whatever already said "sent"
 * is in the bucket.
 */

type Row = {
  id: string;
  name: string;
  state: "waiting" | "sending" | "sent" | "failed";
  error?: string;
};

/** Longest edge, JPEG, stripped of everything the camera wrote into it. */
async function shrink(file: File): Promise<Blob> {
  // `from-image` applies the EXIF rotation, which is also how the rotation
  // gets dropped: the pixels come out the right way up and the tag that
  // said so is gone. The rest of the EXIF block goes with it, which is the
  // point. A phone writes GPS coordinates into a photograph, and a set of
  // coordinates taken at an event is the kind of thing this organization
  // does not collect by accident.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, RESIZE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no canvas");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.86),
  );
  if (!blob) throw new Error("no blob");
  return blob;
}

async function send(code: string, file: File, credit: string): Promise<void> {
  let body: Blob = file;
  let name = file.name;
  try {
    body = await shrink(file);
    name = name.replace(/\.[^.]+$/, "") + ".jpg";
  } catch {
    // A format the canvas will not decode, or a photograph large enough to
    // exhaust the tab. Send the original: the route accepts it, and a
    // slower upload beats a lost one.
  }

  const form = new FormData();
  form.append("file", new File([body], name, { type: body.type || file.type }));
  if (credit) form.append("credit", credit);

  const response = await fetch(`/api/drop/${encodeURIComponent(code)}`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? "That did not send.");
  }
}

export function Drop({ drop }: { drop: DropConfig }) {
  const [stage, setStage] = useState<"film" | "upload">("film");
  const [ended, setEnded] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [credit, setCredit] = useState("");
  const [dragging, setDragging] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const creditRef = useRef("");
  const open = dropIsOpen(drop, new Date());

  creditRef.current = credit;

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    // Muted autoplay is allowed almost everywhere, but "almost" is not a
    // plan. If the promise rejects, a play control appears over the poster
    // and nothing else about the page changes.
    void element.play().catch(() => setNeedsTap(true));
  }, []);

  const queue = useCallback(
    (files: FileList | File[]) => {
      const picked = Array.from(files).filter((file) =>
        file.type ? file.type.startsWith("image/") : /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name),
      );
      if (picked.length === 0) return;

      const added: Row[] = picked.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        state: "waiting",
      }));
      setRows((current) => [...current, ...added]);

      const mark = (id: string, patch: Partial<Row>) =>
        setRows((current) =>
          current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
        );

      // Two at a time. One is slow on a good connection and four of them
      // fighting over a course wifi access point is slower than two.
      const jobs = picked.map((file, index) => ({ file, row: added[index]! }));
      const lanes = Array.from({ length: Math.min(2, jobs.length) }, async () => {
        for (;;) {
          const job = jobs.shift();
          if (!job) return;
          mark(job.row.id, { state: "sending" });
          try {
            await send(drop.code, job.file, creditRef.current);
            mark(job.row.id, { state: "sent" });
          } catch (first) {
            try {
              await send(drop.code, job.file, creditRef.current);
              mark(job.row.id, { state: "sent" });
            } catch (second) {
              mark(job.row.id, {
                state: "failed",
                error: second instanceof Error ? second.message : String(first),
              });
            }
          }
        }
      });
      void Promise.all(lanes);
    },
    [drop.code],
  );

  const sent = rows.filter((row) => row.state === "sent").length;
  const failed = rows.filter((row) => row.state === "failed").length;
  const busy = rows.some((row) => row.state === "waiting" || row.state === "sending");

  if (stage === "film") {
    return (
      <main className={`${styles.page} ${styles.filmStage}`}>
        <div className={styles.film}>
          <video
            ref={video}
            className={styles.video}
            src={drop.video}
            muted
            playsInline
            autoPlay
            preload="auto"
            onPlaying={() => setNeedsTap(false)}
            onEnded={() => setEnded(true)}
          />
          {needsTap ? (
            <button
              type="button"
              className={styles.tap}
              onClick={() => void video.current?.play()}
            >
              Play
            </button>
          ) : null}
        </div>

        {/*
          On screen from the first paint, before the video has loaded a
          frame. The film leads, but it never holds anybody hostage.
        */}
        <div className={styles.gate}>
          <button
            type="button"
            className={`${styles.choose} ${ended ? styles.chooseReady : ""}`}
            onClick={() => setStage("upload")}
          >
            {open ? "Send your photos" : "Continue"}
          </button>
          {ended ? (
            <button
              type="button"
              className={styles.again}
              onClick={() => {
                setEnded(false);
                const element = video.current;
                if (element) {
                  element.currentTime = 0;
                  void element.play();
                }
              }}
            >
              Watch again
            </button>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.bar}>
        <p className={styles.eyebrow}>Joint Special Operations Association</p>
        <p className={styles.barTitle}>{drop.event}</p>
      </header>

      <section className={styles.panel}>
        {open ? (
          <>
            <h1 className={styles.heading}>Send us your photos</h1>
            <p className={styles.lede}>
              If you took something good today, put it here. No account, no sign-in.
              As many as you like.
            </p>

            <div
              className={`${styles.zone} ${dragging ? styles.zoneOn : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                queue(event.dataTransfer.files);
              }}
            >
              <button
                type="button"
                className={styles.choose}
                onClick={() => input.current?.click()}
              >
                Choose photos
              </button>
              <p className={styles.zoneNote}>or drag them in</p>
              <input
                ref={input}
                type="file"
                accept={ACCEPTED_TYPES.join(",")}
                multiple
                className={styles.input}
                onChange={(event) => {
                  if (event.target.files) queue(event.target.files);
                  event.target.value = "";
                }}
              />
            </div>

            <label className={styles.credit}>
              <span className={styles.creditLabel}>Your name, if you want the credit</span>
              <input
                type="text"
                value={credit}
                maxLength={80}
                autoComplete="name"
                placeholder="Optional"
                className={styles.creditInput}
                onChange={(event) => setCredit(event.target.value)}
              />
            </label>

            {rows.length > 0 ? (
              <ul className={styles.rows}>
                {rows.map((row) => (
                  <li key={row.id} className={styles.row}>
                    <span className={styles.rowName}>{row.name}</span>
                    <span className={`${styles.rowState} ${styles[row.state]}`}>
                      {row.state === "waiting" ? "waiting" : null}
                      {row.state === "sending" ? "sending" : null}
                      {row.state === "sent" ? "sent" : null}
                      {row.state === "failed" ? (row.error ?? "failed") : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {sent > 0 && !busy ? (
              <p className={styles.done}>
                {sent} {sent === 1 ? "photo" : "photos"} sent. Thank you.
                {failed > 0 ? " The ones marked failed did not go. Try them again." : ""}
              </p>
            ) : null}

            <p className={styles.small}>
              These go straight to the board and nowhere else. Nothing you send is
              published anywhere without asking you first. Your phone shrinks each
              photo before it leaves, which also strips the location it recorded.
            </p>
          </>
        ) : (
          <>
            <h1 className={styles.heading}>This one has closed</h1>
            <p className={styles.lede}>
              Photographs for {drop.event} are no longer being collected here. If you
              still have some, write to connect@thejsoa.org and say which event.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
