"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import styles from "../drop.module.css";

/**
 * Everything that has been sent in, newest first.
 *
 * Plain <img> straight at the gallery's own route, so the browser caches
 * them, the back button works, and a long press saves one. The board's
 * review page has to fetch through an Authorization header and juggle
 * object URLs; this page does not, and should not pay for machinery it
 * has no use for.
 *
 * There is a refresh button rather than a poll. Most of the people using
 * this are not going to leave a tab open, and a page that quietly
 * reloads itself is a page that moves under somebody's thumb.
 */

type Item = { key: string; credit?: string };
type Feed = { closed?: boolean; count?: number; objects?: Item[] };

function longDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  return `${date.getUTCDate()} ${date.toLocaleString("en-GB", {
    month: "long",
    timeZone: "UTC",
  })}`;
}

export function Gallery({
  code,
  event,
  where,
  closesAt,
}: {
  code: string;
  event: string;
  where: string;
  closesAt: string;
}) {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/drop/${code}/gallery`, {
        cache: "no-store",
      });
      setFeed((await response.json()) as Feed);
    } catch {
      setFeed({ objects: [] });
    } finally {
      setBusy(false);
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = feed?.objects ?? [];

  return (
    <main className={styles.page}>
      <header className={styles.bar}>
        <p className={styles.eyebrow}>Joint Special Operations Association</p>
        <p className={styles.barTitle}>{event}</p>
      </header>
      <section className={styles.panel}>
        <h1 className={styles.heading}>Gallery</h1>
        <p className={styles.lede}>
          {where}. Everything sent in so far, newest first. Tap a photo to open
          it full size, then press and hold to save it.
        </p>

        {feed?.closed ? (
          <p className={styles.small}>
            This gallery closed on {longDate(closesAt)}. If you still have
            photographs from the day, write to connect@thejsoa.org.
          </p>
        ) : feed === null ? (
          <ul className={styles.grid}>
            {[0, 1, 2, 3, 4, 5].map((slot) => (
              <li key={slot} className={styles.tile}>
                <span className={styles.thumbWait} />
              </li>
            ))}
          </ul>
        ) : items.length === 0 ? (
          <p className={styles.small}>
            Nothing has been sent in yet. Yours would be the first.
          </p>
        ) : (
          <>
            <p className={styles.countLine}>
              {items.length} {items.length === 1 ? "photo" : "photos"}
            </p>
            <ul className={styles.grid}>
              {items.map((item) => (
                <li key={item.key} className={styles.tile}>
                  <a
                    href={`/api/drop/${code}/public?key=${encodeURIComponent(item.key)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/drop/${code}/public?thumb=1&key=${encodeURIComponent(item.key)}`}
                      alt=""
                      loading="lazy"
                      className={styles.thumb}
                    />
                  </a>
                  {item.credit ? (
                    <span className={styles.creditTag}>{item.credit}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}

        {feed?.closed ? null : (
          <button
            type="button"
            className={styles.again}
            disabled={busy}
            onClick={() => void load()}
          >
            {busy ? "Checking" : "Check for new photos"}
          </button>
        )}

        <Link className={`${styles.choose} ${styles.sendAll}`} href={`/drop/${code}`}>
          Send your photos
        </Link>

        <p className={styles.small}>
          This gallery is for the people who were there. It is not on the
          Association&rsquo;s website, it cannot be found through a search
          engine, and it closes on {longDate(closesAt)}. If one of these is
          yours and you would rather it came down, write to
          connect@thejsoa.org and it will.
        </p>
      </section>
    </main>
  );
}
