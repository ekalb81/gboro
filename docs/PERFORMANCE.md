# Performance

How fast the downtown model draws, how to measure it, and what was done about it.

## Running the benchmark

The benchmark needs Playwright and its Chromium once:

```
npm install --no-save playwright
npx playwright install chromium
```

Then, in Command Prompt from the repo folder:

```
npm run bench
```

It starts the local server on a spare port, opens the model in headless Chromium for each scenario below, measures
for 8 seconds after a 3 second settle, prints a table and stops the server. Options go after `--`:

```
npm run bench -- --only desktop,zoomed-out     only these scenarios
npm run bench -- --secs 15                     measure longer
npm run bench -- --json bench.json             also save the numbers
npm run bench -- --profile profiles            save a CPU profile per scenario (open in Chrome DevTools > Performance)
npm run bench -- --query time=night            extra URL parameters for every scenario
npm run bench -- --headed                      show the browser: uses your real graphics card
```

Every scenario opens `?date=2026-11-13&wind=18-30@230&time=day&bench`: fall colour with leaves coming down, an 18 mph
south-west wind gusting 30, midday light. `?bench` turns on the timings inside `model.js` (`window.__bench`); without it
nothing is recorded.

| Scenario | What it is |
| --- | --- |
| desktop | 1920x1080 window, device pixel ratio 1, the opening view |
| desktop-dpr2 | the same at device pixel ratio 2 (a high-DPI laptop or monitor) |
| zoomed-in | `z=6`, closest zoom |
| zoomed-out | `z=0.5`, nearly the whole model on screen (all ~250 cars and the people) |
| pan-zoom | drags back and forth and zooms in and out with the wheel the whole time (new tiles get drawn) |
| laptop-4x | 1366x768, CPU slowed 4x (a modest laptop) |
| phone-4x | 390x844 at pixel ratio 3, touch, CPU slowed 4x |

Columns: **fps**; **frame p50/p95/max**, the time between frames (ms); **work p50/p95**, the time spent inside the
model's `frame()` (ms); **long**, long tasks (over 50 ms); **tiles**, static tiles drawn while measuring; **heap MB**, JS
heap; **canvas MB**, an estimate of canvas backing memory (on-screen layers, tiles, scratch cards, ground texture and
shadow mask); **load KB** as served locally (no compression) and **gzip KB** as GitHub Pages sends it; **1st frame ms**,
from navigation to the first drawn frame. The second table splits the work by phase of `frame()`: `tiles` (laying the
static tiles on), `sim` (traffic, people, train and the list of moving things), `dyn` (drawing the moving things, with
their cut-outs), `blow` (blowing leaves and petals), `grade` (weather, colour grade, lit windows and glow), `tilt`
(tilt-shift blur), `sign` (the lantern clock and vignette), `labels`.

## The graphics card caveat

Headless Chromium in a cloud container has no graphics card: canvases are drawn in software. Software drawing makes
`drawImage`, canvas `filter` (the colour grade's `saturate` and the tilt-shift `blur`) and big fills far slower than a
graphics card does, so the absolute numbers here are pessimistic, and the `grade` and `tilt` phases in particular cost
a small fraction of this on a real machine. Canvas drawing in software is also deferred, so some of one phase's
drawing can show up in the next phase's time. What is trustworthy is the JavaScript itself (`sim`, the occlusion tests,
tile preparation, start-up) and the before/after comparisons. `npm run bench -- --headed` on a real machine gives
real numbers.

## Where the time went (November 2026)

Measured on a 4-core cloud container, before the changes:

1. **Cut-outs for moving things (`dyn`), 30% of a desktop frame, 68% zoomed out.** Nearly every car and person on
   screen (128 of 131 at the opening view, 577 of 602 zoomed out) is drawn on a scratch card with the outlines of
   whatever stands in front of it cut out (`drawCut`). Each card filled about seven outlines on three layers, most of
   them nowhere near the car, and copied all three layers back, even though the lit-window and glow layers are blank
   for a person or a car by day.
2. **Tilt-shift blur (`tilt`), about 45-55% of a frame in software.** A `blur()` filter over the top and bottom bands
   of the canvas every frame. About 30 ms of software blur at desktop size; a graphics card does this in well under a
   millisecond.
3. **Colour grade (`grade`), about 10%.** A `saturate()` filter on the full canvas each frame; cheap on a graphics card.
4. **New tiles on pan and zoom.** About 26 ms per 512 px tile, and a zoom step needs a dozen at once (a 280 ms hitch),
   half of it the same cut-out cards for parked cars, trees and lamps behind buildings.
5. **Start-up**: 275 ms of `startModel` script, half of it testing every parked car, tree and lamp against every
   building for what hides it.

The traffic simulation (`stepTraffic`, ~250 cars) is about 0.5 ms a frame, the blowing leaves about 0.5 ms, labels
next to nothing. Neither was worth touching.

## What changed

All of it leaves the picture the same pixel for pixel (see Checking below).

- `drawCut`: fills only the outlines whose box meets the card; skips the lit-window and glow scratch layers while
  nothing has been painted on them (they are not cleared, cut or copied).
- `frame`: tests buildings for line of sight only near the moving thing once something in front is already known
  (whether a card is used at all is decided exactly as before); occluder lookups use number keys instead of strings.
- `blockersFor`: one bounding-box test per building for all of a thing's sample points before the line-of-sight test
  (start-up and every frame).
- `renderTile`: a tile whose lit-window or glow layer is blank gives that canvas back and it is not copied each frame
  (most tiles by day): about a third less canvas memory.
- Tilt-shift: only the two blurred bands are laid on (the mask is clear between them); the mask gradient and the
  vignette are made once per canvas size.
- Each tree's look for the day (`look()`) is kept rather than worked out for all 633 trees every frame; one New York
  time formatter is reused instead of building an `Intl.DateTimeFormat` several times a frame.

## Before and after

Full benchmark, software drawing (8 s per scenario; run-to-run noise is about ±10%):

| Scenario | fps | frame p50 / p95 ms | work p50 ms | canvas MB | 1st frame ms |
| --- | --- | --- | --- | --- | --- |
| desktop (1920x1080@1) | 8.9 → 9.6 | 117 / 145 → 101 / 135 | 111 → 95 | 69.7 → 45.7 | 803 → 680 |
| desktop-dpr2 (1920x1080@2) | 7.4 → 9.4 | 145 / 173 → 107 / 119 | 138 → 100 | 69.6 → 45.6 | 707 → 653 |
| zoomed-in | 58.1 → 59.7 | 16.7 / 23 → 16.7 / 20.5 | 14.1 → 9.2 | 11.8 → 7.8 | 703 → 656 |
| zoomed-out | 6.1 → 8.5 | 178 / 206 → 109 / 178 | 171 → 99 | 69.6 → 45.6 | 775 → 688 |
| pan-zoom | 11 → 14.7 | 117 / 158 → 83 / 117 | 111 → 78 | 108.7 → 58.7 | 782 → 673 |
| laptop-4x (1366x768, CPU/4) | 3.0 → 4.0 | 410 / 459 → 258 / 307 | 389 → 235 | 34.4 → 22.4 | 2202 → 1506 |
| phone-4x (390x844@3, CPU/4) | 2.1 → 2.0 | 656 / 748 → 522 / 566 | 633 → 488 | 87.4 → 55.4 | 2112 → 1567 |

Mean ms per frame by phase (the tilt-shift blur is software-only cost and did not change):

| Scenario | dyn | grade | tilt |
| --- | --- | --- | --- |
| desktop | 34.4 → 15.8 | 13.2 → 9.2 | 65 → 73 |
| desktop-dpr2 | 49.6 → 20.2 | 17.2 → 10.2 | 71 → 69 |
| zoomed-in | 5.8 → 3.0 | 1.6 → 0.8 | 6.5 → 5.8 |
| zoomed-out | 116.3 → 44.9 | 8.2 → 13.1 | 42.8 → 48.9 |
| pan-zoom | 32.0 → 13.9 | 9.8 → 5.5 | 42.7 → 41.1 |
| laptop-4x | 212.1 → 82.0 | 42.9 → 26.6 | 120.8 → 122.1 |
| phone-4x | 199.2 → 84.4 | 81.7 → 52.3 | 346 → 347 |

Closer to a machine with a graphics card: the same build with the two canvas filters (blur, saturate) switched off
for the measurement only, since those are what a graphics card makes nearly free:

| Scenario | fps | frame p50 ms | work p50 ms |
| --- | --- | --- | --- |
| desktop | 15.9 → 32.5 | 62 → 30 | 51 → 21 |
| zoomed-out | 7.5 → 17.0 | 135 → 57 | 122 → 46 |
| pan-zoom | 21.0 → 35.2 | 51 → 31 | 44 → 22 |
| laptop-4x | 3.6 → 7.6 | 276 → 128 | 252 → 101 |
| phone-4x | 3.2 → 6.1 | 314 → 161 | 265 → 111 |

Other numbers: a new static tile takes about 15 ms instead of 26 ms (so a zoom step's hitch is about 40% shorter);
`startModel` script at load went from 275 ms to 150 ms. The page loads 829 KB (218 KB gzipped), of which
`model/downtown.json` is 512 KB (145 KB gzipped; 224 KB of it is the ground-cover grid `GC`). The "long" column goes up
in some rows only because more frames a second fit in the 8 seconds, each still over 50 ms in software.

## Checking the picture did not change

Screenshots of the same views before and after, with `Math.random` seeded, the clock faked and the frames stepped
by hand (exactly 180 frames of 1/60 s), so every run draws the same thing: the opening view at pixel ratio 1 and 2,
zoomed in and out, the phone, night (two zooms), spring dusk with petals, a storm with road closures, and a pan and
zoom by keyboard. All are identical pixel for pixel, except the storm view, where 366 pixels in the HTML alert chip
(not the model) differ between any two runs.

## What is left, and whether to change engines

- **Tilt-shift blur** is the biggest software cost (30+ ms a frame). On a graphics card it is cheap. Making it cheaper
  in software would mean blurring at half resolution or a different blur, which changes the picture slightly, so it
  was left as it is.
- **The cut-out cards** are still the main JavaScript cost: 16 ms a frame at the opening view and 45 ms zoomed out in
  software. On a graphics card each card is a small software canvas uploaded to the card two to four times. Drawing
  people and cars with fewer cards (straight onto the picture when no outline actually overlaps them) would remove
  most of that, but it changes, very slightly, how the glow layer is cut under them, so it was not done.
- **WebGL or a worker**: not warranted yet. With the filters on the graphics card the model's own work is about
  20 ms a frame on this slow container at the opening view (100 ms with the CPU slowed 4x); a typical desktop CPU is
  2-3x faster than this container, which puts it near 60 fps. Measure on a real machine with
  `npm run bench -- --headed` first. If a mid-range laptop still shows `dyn` over 10 ms a frame there, a WebGL
  renderer (depth-sorted sprites with a depth test instead of cut-out cards) is the change that would remove it; a
  worker with OffscreenCanvas would only move the same work off the main thread.
