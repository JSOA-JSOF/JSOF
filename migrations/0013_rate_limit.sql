-- Rate limiting.
--
-- There was none anywhere: not on sign-in link requests, not on TOTP
-- attempts, not on the photo drop. A six digit code with a one step
-- window is a million possibilities over ninety seconds, which nobody
-- guesses by hand and a script guesses easily.
--
-- The sign-in form matters for a second reason now that mail actually
-- sends. Without a limit it is an unauthenticated way to make this
-- organization send email to any address somebody types, which is how
-- a charity's domain ends up with a reputation problem it did not
-- earn.
--
-- A table rather than a counter in memory, because a Worker isolate is
-- recycled between requests and an in-memory limit on Workers is a
-- limit per isolate, which is no limit at all.
CREATE TABLE rate_counter (
  -- What is being limited and who by: 'signin:someone@example.org',
  -- 'mfa:<session id>', 'drop:<ip hash>'. Never a raw IP address --
  -- see the note in src/lib/ratelimit.ts.
  bucket     TEXT NOT NULL,
  -- The window this count belongs to, as an ISO timestamp truncated
  -- to the window size. Rolling windows need a row per event; fixed
  -- windows need one row per bucket and are enough here.
  window_at  TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_at)
);

-- Old windows are not interesting and should not accumulate. Swept by
-- the same worker that drains the outbox.
CREATE INDEX rate_counter_window ON rate_counter(window_at);
