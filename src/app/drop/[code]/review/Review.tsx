"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import styles from "../drop.module.css";

/**
 * Look at what came in, and pull down the ones worth keeping.
 *
 * The key never reaches the server as a query parameter and never lands in
 * a URL: it goes in an Authorization header, and it is held in
 * sessionStorage so a reload does not ask again but closing the tab
 * forgets it. A key in a URL ends up in browser history, in a shared
 * screenshot, and in whatever logs sit between here and the Worker.
 *
 * Thumbnails load as they come into view rather than all at once, because
 * a tournament's worth of photographs fetched in parallel is a stalled tab
 * and a lot of pointless transfer for somebody who wanted to see the first
 * dozen.
 */

type Item = {
  key: string;
  size: number;
  uploaded: string;
  credit?: string;
  originalName?: string;
  /** The sender ticked the public-page box. */
  share: boolean;
  /** The board has cleared it for the public page. */
  approved: boolean;
};

type Manifest = { event: string; count: number; bytes: number; objects: Item[] };

const STORE_KEY = "jsoa:drop-admin-key";

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function Thumb({
  code,
  item,
  authKey,
  onApproved,
}: {
  code: string;
  item: Item;
  authKey: string;
  onApproved: (key: string, approved: boolean) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let object: string | null = null;
    let cancelled = false;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void (async () => {
          const response = await fetch(
            `/api/drop/${code}/object?key=${encodeURIComponent(item.key)}`,
            { headers: { Authorization: `Bearer ${authKey}` } },
          );
          if (!response.ok || cancelled) return;
          object = URL.createObjectURL(await response.blob());
          setUrl(object);
        })();
      },
      { rootMargin: "400px" },
    );
    observer.observe(element);

    return () => {
      cancelled = true;
      observer.disconnect();
      if (object) URL.revokeObjectURL(object);
    };
  }, [code, item.key, authKey]);

  const name = item.originalName ?? item.key.split("/").pop() ?? "photo.jpg";

  const setApproved = async (approved: boolean) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/drop/${code}/approve`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key: item.key, approved }),
      });
      if (response.ok) onApproved(item.key, approved);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li ref={box} className={styles.tile}>
      {url ? (
        <a href={url} download={name} title={`${name} · ${megabytes(item.size)}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={name} className={styles.thumb} />
        </a>
      ) : (
        <span className={styles.thumbWait} />
      )}
      {item.credit ? <span className={styles.creditTag}>{item.credit}</span> : null}
      {/*
        No control at all where the sender did not agree. The route
        refuses it anyway, and a button that is going to be refused is
        worse than no button: it reads as something the board may override.
      */}
      {item.share ? (
        <button
          type="button"
          disabled={busy}
          className={`${styles.mark} ${item.approved ? styles.markOn : ""}`}
          onClick={() => void setApproved(!item.approved)}
        >
          {item.approved ? "Public" : "Approve"}
        </button>
      ) : (
        <span className={styles.markOff}>Private</span>
      )}
    </li>
  );
}

export function Review({ code, event }: { code: string; event: string }) {
  const [authKey, setAuthKey] = useState("");
  const [typed, setTyped] = useState("");
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (key: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/drop/${code}/manifest`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!response.ok) {
        // The route answers 404 for a wrong key on purpose, so this page
        // has to be the one that says what actually happened.
        throw new Error("That key was not accepted.");
      }
      const body = (await response.json()) as Manifest;
      setManifest(body);
      setAuthKey(key);
      sessionStorage.setItem(STORE_KEY, key);
    } catch (problem) {
      setManifest(null);
      setError(problem instanceof Error ? problem.message : "Could not load.");
      sessionStorage.removeItem(STORE_KEY);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    const saved = sessionStorage.getItem(STORE_KEY);
    if (saved) void load(saved);
  }, [load]);

  if (!manifest) {
    return (
      <main className={styles.page}>
        <section className={styles.panel}>
          <h1 className={styles.heading}>{event}</h1>
          <p className={styles.lede}>Board access. Paste the drop key.</p>
          <form
            onSubmit={(formEvent) => {
              formEvent.preventDefault();
              if (typed.trim()) void load(typed.trim());
            }}
          >
            <label className={styles.credit}>
              <span className={styles.creditLabel}>Drop key</span>
              <input
                type="password"
                value={typed}
                autoComplete="off"
                className={styles.creditInput}
                onChange={(changed) => setTyped(changed.target.value)}
              />
            </label>
            <button type="submit" className={`${styles.choose} ${styles.sendAll}`}>
              {loading ? "Checking" : "Open"}
            </button>
          </form>
          {error ? <p className={styles.errorNote}>{error}</p> : null}
        </section>
      </main>
    );
  }

  const live = manifest.objects.filter((item) => item.approved).length;

  return (
    <main className={styles.page}>
      <header className={styles.bar}>
        <p className={styles.eyebrow}>Joint Special Operations Association</p>
        <p className={styles.barTitle}>{event}</p>
      </header>
      <section className={styles.panel}>
        <h1 className={styles.heading}>
          {manifest.count} {manifest.count === 1 ? "photograph" : "photographs"}
        </h1>
        <p className={styles.lede}>
          {megabytes(manifest.bytes)} in total, {live} on the public page. Tap a
          photograph to download it. For all of them at once, run{" "}
          <code>scripts/collect-photos.sh {code}</code>.
        </p>
        <p className={styles.small}>
          Approve only puts a photograph on the public page. It is offered on
          the ones whose sender ticked the box and on no others. Pressing it
          again takes the photograph back down.
        </p>
        {manifest.count === 0 ? (
          <p className={styles.small}>Nothing has been sent yet.</p>
        ) : (
          <ul className={styles.grid}>
            {manifest.objects.map((item) => (
              <Thumb
                key={item.key}
                code={code}
                item={item}
                authKey={authKey}
                onApproved={(key, approved) =>
                  setManifest((current) =>
                    current
                      ? {
                          ...current,
                          objects: current.objects.map((object) =>
                            object.key === key ? { ...object, approved } : object,
                          ),
                        }
                      : current,
                  )
                }
              />
            ))}
          </ul>
        )}
        <button
          type="button"
          className={styles.again}
          onClick={() => {
            sessionStorage.removeItem(STORE_KEY);
            setManifest(null);
            setTyped("");
          }}
        >
          Lock
        </button>
      </section>
    </main>
  );
}
