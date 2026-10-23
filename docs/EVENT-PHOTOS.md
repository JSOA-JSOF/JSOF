# Event photo drops

## What it is

A page people reach by scanning a code on a sign at an event. It plays a
short film, and underneath it they send photographs. No account, no
sign-in, nothing to install.

The golf tournament's drop:

    https://thejsof.org/drop/golf26-k7n2xqvp4m

It closes on 6 November 2026 on its own.

## Getting the photographs back

Three ways, in the order you will want them.

**The review page**, for looking:

    https://thejsof.org/drop/golf26-k7n2xqvp4m/review

Paste the drop key and it shows everything that has come in, as
thumbnails, with whoever asked for the credit under each one. Tap a
photograph to download it. The key goes in a header rather than the URL,
so it does not end up in browser history or in a screenshot of the
address bar, and it is held for the tab only: closing the tab forgets it.
Nothing links to this page.

**The script**, for the real collection:

```bash
DROP_ADMIN_KEY='...' scripts/collect-photos.sh golf26-k7n2xqvp4m
```

That writes into `event-photos/golf26-k7n2xqvp4m/`: every photograph, plus
a `manifest.csv` giving the filename, the credit the sender asked for,
what the file was called on their phone, and when it arrived. Run it again
later and it skips what it already has, so the stragglers who get home and
remember on Sunday cost one more run and nothing else.

**The dashboard**, for everything else: Cloudflare, R2,
`jsoa-event-photos`, folder `golf-2026/`. This is the one that can delete
things.

`DROP_ADMIN_KEY` is a Worker secret, not a thing to paste into a shared
document. It is already set. To replace it:

```bash
openssl rand -base64 32 | npx wrangler secret put DROP_ADMIN_KEY
```

## What it costs

R2's free tier is 10GB of storage, a million writes a month and free
egress. A photograph arrives at roughly 400KB to 1.2MB, because the phone
resizes it before it uploads, so 10GB is somewhere around twelve thousand
photographs.

A tournament with 150 people sending 20 each is 3,000 photographs, about
2.5GB. Three or four events a year fit inside the free tier.

Going over is not a cliff. Storage past 10GB is $0.015 per GB per month, so
20GB costs fifteen cents a month. The thing to watch is not the bill, it is
leaving old events in the bucket forever: pull them down with the script,
put them wherever the Association keeps its records, and delete the prefix.

## The poster

```bash
python3 scripts/make-poster.py golf26-k7n2xqvp4m ~/Desktop/golf-poster.pdf
```

US Letter, white, one page, ready to email or print. It reads the drop out
of `src/lib/drop/config.ts`, so the URL on the paper and the URL the Worker
serves cannot drift apart, and it generates its own QR on the way.

White rather than black on purpose. A dark poster is handsome on a screen
and a toner cartridge on paper, and the code has to sit on white anyway.

## Adding the next event

One entry in `src/lib/drop/config.ts`, a new code, a clip in `public/media`,
and a new QR:

```bash
swift scripts/make-qr.swift "https://thejsof.org/drop/<code>" ~/Desktop/<event>.png 2048
```

Generate the code with something that is actually random, for example
`openssl rand -hex 5`, and do not reuse one.

## Why it is built this way

**The code in the URL is the whole access control.** Nobody at a golf
course is going to make an account, and a form that asks for one collects
nothing. The secret travels on a printed sign rather than over the network,
and there is nothing behind it to steal because the upload route only
writes. It is not a password and is not treated as one: it is printed in
public. If it leaks, rotate it in the config and print a new sign.

**The film never blocks the uploader.** It plays, and the uploader is live
from the first paint underneath it. A refused autoplay, a slow start, data
saver, or somebody who simply does not care: none of it costs a submission.

**The phone resizes before it uploads.** A 4MB photograph becomes about
600KB, which on a course network is the difference between working and not.
It also drops the EXIF block, and that is the part worth saying out loud: a
phone writes GPS coordinates into every photograph, and a set of
coordinates taken at a JSOC-affiliated event is not something this
organization should be collecting by accident.

**One request per photograph, two at a time, one retry.** A dropped
connection at photograph nine costs photograph nine, not the first eight.
Closing the page loses nothing that already said sent.

**Nothing is sent until they press send.** Choosing photographs fills a
tray of thumbnails with a cross on each one, and the upload begins when
they press the button under it. Sending on selection is one tap fewer and
the wrong trade: on a phone the picker is a grid of stamps, picking the
wrong shot or thirty when you meant three is the normal case, and the only
undo would be asking the board to delete it. For a photograph of other
people at an Association event, that is a bad place to put the undo
button.

**Nothing is published.** The upload route has no GET. The two routes that
read are behind a key the board holds and the sign does not carry, and the
object route will only serve keys under its own drop's prefix, so a key for
one event cannot read another. The page tells people their photographs go
to the board and nowhere else, and that promise is the reason for all three
of those.
