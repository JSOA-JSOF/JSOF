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

## The gallery

    https://thejsof.org/drop/golf26-k7n2xqvp4m/gallery

Linked from under the film, from under the uploader, and from the green
box that appears the moment something has been sent.

**It exists so that somebody can see their photographs arrived.** Most of
the people at this event are not young, "it says sent" is a weaker
reassurance than seeing the photograph, and somebody who is not sure will
send everything a second time. So everything shows, newest first, and
sending ends on "They are in the gallery now. Have a look and check they
all arrived."

It was built the other way first, with a tick box and board approval
before anything appeared. That is the right shape for publishing and the
wrong shape for this: behind two gates the sender sees nothing, which is
the one thing the gallery is for.

**It is not publication, and the page says so rather than implying it.**
The address is unlisted and reachable only by scanning the code on the
sign, it is noindex, it is not on the Association's website, and it
closes with the drop on 6 November. After that the gallery routes stop
serving and say the gallery has closed.

**The board can take any photograph out.** Every tile on the review page
carries an In gallery button; pressing it hides that photograph, pressing
it again puts it back, and either takes effect within the minute. Both
the listing and the route that serves the pixels check the hide list, so
a link somebody already has stops working too. The hide list is a small
JSON file in the bucket, outside the drop's prefix, and if it cannot be
read the gallery serves nothing rather than everything.

Turn the whole thing off for an event with `gallery: false` in
`src/lib/drop/config.ts`.

### Two sizes

The handset uploads the photograph at 2560px and a 640px copy beside it,
both from one decode, so the second costs almost nothing where it is made
and saves every viewer afterwards. The grid uses the small copy: about
100KB rather than 650KB, which on a course network is the difference
between a gallery and a blank screen. Anything uploaded before this
existed has no small copy and falls back to the full size.

Thumbnails live under `<prefix>/thumbs/` and are filtered out of the
manifest, the gallery listing and `collect-photos.sh`, so counts are
counts of photographs. A thumbnail key cannot be requested directly,
which keeps the hide check from being walked around by naming the small
copy.

## The poster## The poster

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

**Nothing reaches the website.** The upload route has no GET. The two
routes that read for the board need a key the board holds and the sign
does not carry, and they will only serve keys under their own drop's
prefix, so a key for one event cannot read another. The gallery serves
without a key, but only while the drop is open, only what the board has
not hidden, and only at an unlisted, noindex address nobody finds by
accident. None of it appears on thejsoa.org or thejsof.org, and the page
says that rather than implying it.
