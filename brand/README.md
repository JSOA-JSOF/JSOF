# Brand folder

Drop source files in here. Nothing in this folder is served to anybody:
it is the shelf the originals sit on. What the site serves lives in
`public/media/`, and it gets there by being processed, reviewed and
written into a manifest, never by being copied.

## Where to put what

| Folder | What goes in it |
| --- | --- |
| `crest/` | The crest and any wordmark, in the best format you have. Vector (`.ai`, `.eps`, `.svg`, `.pdf`) beats a PNG beats a screenshot. |
| `sponsors/` | Sponsor logo packs. One file per company, named after the company. This is where the artwork pack from the banner printer goes. |
| `partners/` | The same, for partner organizations. |
| `photos/` | Event photography, before anybody has looked at it. See the OPSEC note below. |
| `video/` | Source clips, full quality. They get compressed on the way out. |
| `documents/` | Anything that is reference rather than artwork: the statement of work, brand guidance, a sponsorship agreement, a 990. |

Names do not have to be tidy. `Widelity logo FINAL v3 (1).ai` is fine; I
will rename it on the way through.

## What happens to a file after you drop it

1. **Processed.** Logos get trimmed and converted, usually to SVG where
   the source is vector and WebP where it is not. Photographs get resized
   and stripped of EXIF, which is where the GPS coordinates live. Video
   gets re-encoded at a bitrate that will load on a phone.
2. **Written into a manifest.** Either `src/app/(public)/media.ts`, which
   records what OPSEC review was done on a photograph, or
   `src/app/(public)/sponsor-logos.ts`, which records whose trademark a
   mark is and whether we hold permission to show it. A test refuses to
   render an image that is in neither.
3. **Committed to `public/media/`.** Only then does it reach the site.

## Two things worth knowing before you drop photographs in

**OPSEC.** No member faces, no name tapes, no legible unit insignia on
any public page. Every photograph on the site is classified in the
manifest as having no people, unidentifiable people, or recognisable
people who are not real. A real, identifiable member needs signed
releases and a board decision, not a manifest entry. If you are not sure
about a photograph, drop it in and say so rather than deciding.

**Rights.** For a sponsor's mark, the file they sent you is worth more
than one pulled off their website: it is the current version, and the
fact that they sent it is the permission. Put any email or agreement that
came with it in `documents/`.

## What is tracked in git

Artwork is, because it is small and the site is built from it. Raw
photography and raw video are not, because they are large and the
processed copies are what matter. See `.gitignore` in this folder.
