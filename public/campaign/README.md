# Campaign cards

Square (1080×1080) social cards for the Mukoko News launch campaign, served
from `news.mukoko.com/campaign/*.png`.

They live in `public/` for one reason: **Postiz uploads media from a public
URL**, and this is the only origin we control that serves static files. They
are not product assets — nothing in the app links to them, and deleting the
directory breaks no page.

## The numbers on them are measured, not decorative

Every figure was read off the live corpus on 2026-09-11 and is exact at that
date: 65,204 articles · 537 newsrooms · 43 of 54 countries producing · the
top-six country counts over the preceding 30 days.

They will drift. A card is a fixed picture of a live query, so **re-generate
rather than re-caption** when the figures move: the generator lives with the
campaign brief, and the whole point of this project's coverage doctrine is
that nobody types the number.

## Brand

Ground is `--container-tanzanite` (`#1A0033`) with `--on-container-tanzanite`
(`#EDE0F3`) for body text — a pair already measured at APCA Lc 89.8, so the
contrast here is not a fresh guess. The stripe is the seven minerals at their
**dark** values, in ring order, because the card is a dark surface. The
wordmark is Noto Serif, lowercase, always "mukoko".
