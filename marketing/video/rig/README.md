# Capture rig

Drives the real app against the seeded demo persona and records a frame
sequence, then encodes a 16:9 master and a 9:16 crop.

It records **screen footage of the actual product**. It does not generate video,
write voiceover, or add music — those stay in the edit.

## Running a shot

The rig refuses to film anything but the demo, so start a `DEMO_DB=1` server
first. That flag puts the database in `:memory:` (`web/db/index.ts`), which means
a capture run physically cannot open your real database.

```sh
# the isolated worktree, never the main one (README.md rule 2)
cd /Users/kevingeorge/dev/budgetr-video/web
DEMO_DB=1 PORT=3100 npm start

# then, from this directory
npm install
node shoot.mjs 01-price-creep      # → out/01-price-creep/frames/*.jpg
node compose.mjs 01-price-creep    # → master.mp4 + vertical.mp4
```

`BASE_URL` overrides the target. Port 3000 is rejected outright — that's the
launchd service on the real database.

## Why frames instead of a screen recording

Every frame is an explicit screenshot, so motion is exactly what the shot script
asked for: no dropped frames, no variable timing, and a re-run in six months
produces an identical file. That's what makes a reshoot match, which is the whole
reason for filming the deterministic demo data in the first place.

A 42-second short is ~1,260 screenshots and takes about 25 seconds to capture.

## Writing a shot

A shot exports `START` (the first route) and `shoot({ page, rec, base })`, and
lives in `shots/`. The engine gives you:

| | |
| --- | --- |
| `rec.frame()` | one screenshot = one frame |
| `rec.hold(s)` | a static beat (copies the last frame — ~50× faster than re-shooting it) |
| `rec.animate(s, ease, fn)` | drive `fn(t)` across `s` seconds, capturing each step |
| `rec.scroll(from, to, s)` | smooth scroll |
| `rec.pushIn(z1, z2, s, ease, holdY)` | camera push-in via CSS `zoom` |
| `frameOn(page, text, place)` | park the element containing `text` at `place` down the frame |
| `titleBeat(rec, page, {...})` | fade a title in, hold, fade out |
| `showSlate(page, {...})` | a full-bleed card for a beat the rig can't shoot |

Keep beat durations equal to the script's. The script is the source of truth;
the shot file is an implementation of it.

## Four things that will waste your afternoon

Each of these fails *silently* — the run completes, the frames look wrong, and
nothing errors.

1. **`reducedMotion: "reduce"` disables CSS `zoom`.** It's the obvious way to
   stop entrance animations varying between takes, and it makes every push-in do
   nothing: the inline style sets, the computed value stays `1`. Settle after
   navigation instead.

2. **Programmatic scrolling doesn't work under root `zoom`.** `window.scrollTo`,
   `documentElement.scrollTop` and `body.scrollTop` all leave `scrollY` at 0
   while a real wheel event scrolls fine. `scrollSet` wheels.

3. **A wheel event is dispatched, not applied.** The scroll lands a beat later on
   the compositor, so a read straight afterwards returns the *old* offset and a
   screenshot catches the *previous* position. `scrollSet` waits for it to land.

4. **The pointer decides what scrolls.** Wheel events go to whatever is under the
   cursor, and the sidebar is its own scroll container — park the pointer over
   the content column or you'll pan the nav while the page sits still. Relatedly,
   picking the scroll container by "most slack" picks the *nav* at high zoom;
   only a scroller containing `<main>` is the shot.

## What the rig can't do

- **The options desk.** Its screens price off a live CBOE chain and the seeder
  has none — hand-recorded during market hours, see `../../README.md`.
- **Anything outside the browser.** Finder windows, the desktop app's menus, the
  phone. Shots calling for those get a slate at the right length so the cut still
  times out, with the instruction on screen.
- **Voice, music, captions.** The script wants voice cold on the first line and
  music in at 0:03 — not a decision for a rig.
