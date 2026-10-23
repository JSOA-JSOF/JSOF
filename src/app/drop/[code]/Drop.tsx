"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ACCEPTED_TYPES,
  RESIZE_MAX_EDGE,
  THUMB_MAX_EDGE,
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

/** A photograph chosen but not yet sent. */
type Picked = {
  id: string;
  file: File;
  /** An object URL for the thumbnail. Revoked when the item leaves. */
  preview: string;
};

function isPhotograph(file: File): boolean {
  return file.type
    ? file.type.startsWith("image/")
    : /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
}

/**
 * Two JPEGs from one decode: the photograph, and a small copy for the
 * gallery grid.
 *
 * Decoding a 12 megapixel photograph is the expensive part and it only
 * happens once. Drawing it twice at two sizes costs almost nothing on
 * top, and it means the gallery never has to serve full photographs as
 * thumbnails.
 */
async function shrink(file: File): Promise<{ full: Blob; thumb: Blob | null }> {
  // `from-image` applies the EXIF rotation, which is also how the rotation
  // gets dropped: the pixels come out the right way up and the tag that
  // said so is gone. The rest of the EXIF block goes with it, which is the
  // point. A phone writes GPS coordinates into a photograph, and a set of
  // coordinates taken at an event is the kind of thing this organization
  // does not collect by accident.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

  const draw = async (edge: number, quality: number): Promise<Blob | null> => {
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
  };

  try {
    const full = await draw(RESIZE_MAX_EDGE, 0.86);
    if (!full) throw new Error("no blob");
    const thumb = await draw(THUMB_MAX_EDGE, 0.72);
    return { full, thumb };
  } finally {
    bitmap.close();
  }
}

async function send(code: string, file: File, credit: string): Promise<void> {
  let body: Blob = file;
  let thumb: Blob | null = null;
  let name = file.name;
  try {
    const sized = await shrink(file);
    body = sized.full;
    thumb = sized.thumb;
    name = name.replace(/\.[^.]+$/, "") + ".jpg";
  } catch {
    // A format the canvas will not decode, or a photograph large enough to
    // exhaust the tab. Send the original: the route accepts it, and a
    // slower upload beats a lost one.
  }

  const form = new FormData();
  form.append("file", new File([body], name, { type: body.type || file.type }));
  if (thumb) form.append("thumb", new File([thumb], `thumb-${name}`, { type: "image/jpeg" }));
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
  const [picked, setPicked] = useState<Picked[]>([]);
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

  // Choosing adds to a tray. Nothing leaves the handset until the person
  // presses send.
  //
  // It used to upload the moment the picker closed, which is fewer taps
  // and the wrong trade. On a phone the picker is a grid of thumbnails the
  // size of a stamp, and picking the wrong shot, or thirty shots when you
  // meant three, is the normal case rather than the careless one. Sending
  // on selection means the only way to take something back is to ask the
  // board to delete it, and for a photograph of other people at an
  // Association event that is a bad place to put the undo button.
  const choose = useCallback((files: FileList | File[]) => {
    const chosen = Array.from(files).filter(isPhotograph);
    if (chosen.length === 0) return;
    setPicked((current) => {
      // The same photograph twice is a double tap, not an intention.
      const seen = new Set(current.map((item) => `${item.file.name}:${item.file.size}`));
      const added = chosen
        .filter((file) => !seen.has(`${file.name}:${file.size}`))
        .map((file) => ({
          id: crypto.randomUUID(),
          file,
          preview: URL.createObjectURL(file),
        }));
      return [...current, ...added];
    });
  }, []);

  const remove = useCallback((id: string) => {
    setPicked((current) => {
      const going = current.find((item) => item.id === id);
      if (going) URL.revokeObjectURL(going.preview);
      return current.filter((item) => item.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setPicked((current) => {
      for (const item of current) URL.revokeObjectURL(item.preview);
      return [];
    });
  }, []);

  const sendAll = useCallback(() => {
    setPicked((current) => {
      if (current.length === 0) return current;

      const added: Row[] = current.map((item) => ({
        id: item.id,
        name: item.file.name,
        state: "waiting",
      }));
      setRows((rowsNow) => [...rowsNow, ...added]);

      const mark = (id: string, patch: Partial<Row>) =>
        setRows((rowsNow) =>
          rowsNow.map((row) => (row.id === id ? { ...row, ...patch } : row)),
        );

      // Two at a time. One is slow on a good connection, and four of them
      // fighting over a course wifi access point is slower than two.
      const jobs = [...current];
      const lanes = Array.from({ length: Math.min(2, jobs.length) }, async () => {
        for (;;) {
          const job = jobs.shift();
          if (!job) return;
          mark(job.id, { state: "sending" });
          try {
            await send(drop.code, job.file, creditRef.current);
            mark(job.id, { state: "sent" });
          } catch (first) {
            try {
              await send(drop.code, job.file, creditRef.current);
              mark(job.id, { state: "sent" });
            } catch (second) {
              mark(job.id, {
                state: "failed",
                error: second instanceof Error ? second.message : String(first),
              });
            }
          } finally {
            URL.revokeObjectURL(job.preview);
          }
        }
      });
      void Promise.all(lanes);
      return [];
    });
  }, [drop.code]);

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
          {drop.gallery ? (
            <Link className={styles.seeAll} href={`/drop/${drop.code}/gallery`}>
              or see the gallery
            </Link>
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
                choose(event.dataTransfer.files);
              }}
            >
              <button
                type="button"
                className={styles.choose}
                onClick={() => input.current?.click()}
              >
                {picked.length > 0 ? "Add more photos" : "Choose photos"}
              </button>
              <p className={styles.zoneNote}>or drag them in</p>
              <input
                ref={input}
                type="file"
                accept={ACCEPTED_TYPES.join(",")}
                multiple
                className={styles.input}
                onChange={(event) => {
                  if (event.target.files) choose(event.target.files);
                  event.target.value = "";
                }}
              />
            </div>

            {picked.length > 0 ? (
              <div className={styles.tray}>
                <div className={styles.trayHead}>
                  <h2 className={styles.trayTitle}>
                    {picked.length} ready to send
                  </h2>
                  <button type="button" className={styles.again} onClick={clear}>
                    Clear
                  </button>
                </div>
                <p className={styles.trayNote}>
                  Nothing has been sent yet. Take any of these out before you do.
                </p>
                <ul className={styles.grid}>
                  {picked.map((item) => (
                    <li key={item.id} className={styles.tile}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.preview}
                        alt={item.file.name}
                        className={styles.thumb}
                      />
                      <button
                        type="button"
                        className={styles.drop}
                        aria-label={`Remove ${item.file.name}`}
                        onClick={() => remove(item.id)}
                      >
                        &#215;
                      </button>
                    </li>
                  ))}
                </ul>

                <label className={styles.credit}>
                  <span className={styles.creditLabel}>
                    Your name, if you want the credit
                  </span>
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

                {/*
                  Where they go, said at the moment of pressing rather than
                  only in the small print at the bottom. This is the whole
                  of what is being agreed to: it is consent to send, and
                  not a licence to publish, because the board has not
                  decided a release and this page is not the place to
                  invent one.
                */}
                <p className={styles.consent}>
                  These go to the Association. They will show in the gallery, so
                  you can check they arrived, until it closes on 6 November.
                  Nothing is put on the website.
                </p>

                <button
                  type="button"
                  className={`${styles.choose} ${styles.sendAll}`}
                  onClick={sendAll}
                >
                  Send {picked.length} {picked.length === 1 ? "photo" : "photos"}
                </button>
              </div>
            ) : null}

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
              <div className={styles.doneBox}>
                <p className={styles.done}>
                  {sent} {sent === 1 ? "photo" : "photos"} sent. Thank you.
                  {failed > 0
                    ? " The ones marked failed did not go. Try them again."
                    : ""}
                </p>
                {drop.gallery ? (
                  <>
                    <p className={styles.doneNote}>
                      They are in the gallery now. Have a look and check they all
                      arrived.
                    </p>
                    <Link
                      className={`${styles.choose} ${styles.sendAll}`}
                      href={`/drop/${drop.code}/gallery`}
                    >
                      See the gallery
                    </Link>
                  </>
                ) : null}
              </div>
            ) : null}

            {drop.gallery ? (
              <Link className={styles.seeAll} href={`/drop/${drop.code}/gallery`}>
                See the gallery &rarr;
              </Link>
            ) : null}

            <p className={styles.small}>
              Your phone shrinks each photo before it leaves, which also strips the
              location it recorded. Nothing is sent until you press the button.
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
