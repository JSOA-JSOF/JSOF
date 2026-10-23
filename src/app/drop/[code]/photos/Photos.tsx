"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "../drop.module.css";

/**
 * What everyone sees.
 *
 * Plain <img> straight at the public object route, so the browser caches
 * them, the back button works, and a long press saves one. The review
 * page has to fetch through an Authorization header and juggle object
 * URLs; this page does not, and should not pay for machinery it has no
 * use for.
 */

type Item = { key: string; credit?: string };

export function Photos({
  code,
  event,
  where,
}: {
  code: string;
  event: string;
  where: string;
}) {
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch(`/api/drop/${code}/gallery`);
        const body = (await response.json()) as { objects?: Item[] };
        if (live) setItems(body.objects ?? []);
      } catch {
        if (live) setItems([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [code]);

  return (
    <main className={styles.page}>
      <header className={styles.bar}>
        <p className={styles.eyebrow}>Joint Special Operations Association</p>
        <p className={styles.barTitle}>{event}</p>
      </header>
      <section className={styles.panel}>
        <h1 className={styles.heading}>Photos from the day</h1>
        <p className={styles.lede}>{where}</p>

        {items === null ? (
          <ul className={styles.grid}>
            {[0, 1, 2, 3, 4, 5].map((slot) => (
              <li key={slot} className={styles.tile}>
                <span className={styles.thumbWait} />
              </li>
            ))}
          </ul>
        ) : items.length === 0 ? (
          <p className={styles.small}>
            Nothing here yet. Photographs appear once the people who took them
            have sent them in and the board has been through them.
          </p>
        ) : (
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
                    src={`/api/drop/${code}/public?key=${encodeURIComponent(item.key)}`}
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
        )}

        <Link className={`${styles.choose} ${styles.sendAll}`} href={`/drop/${code}`}>
          Send yours
        </Link>

        <p className={styles.small}>
          Every photograph here was sent in by somebody who was there and
          agreed to it being shown. If one of these is yours and you would
          rather it came down, write to connect@thejsoa.org and it will.
        </p>
      </section>
    </main>
  );
}
