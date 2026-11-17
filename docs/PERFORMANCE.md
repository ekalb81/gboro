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
npm run bench -- --only interaction            only the drag / wheel / pinch scenarios ('steady' for the rest)
npm run bench -- --swgpu --only zoom           zoom steps one at a time, each taken apart (see the zoom table below)
npm run bench -- --only tiles --query "compose=layers&cut=clip"    what drawing one static tile takes (the per-tile table)
npm run bench -- --warm                        interaction scenarios wait until the model has drawn ahead first
npm run bench -- --query time=night            extra URL parameters for every scenario (they override the defaults)
npm run bench -- --headed                      show the browser: uses your real graphics card
npm run bench -- --swgpu                       headless, canvases on the graphics-card path (see the caveat below)
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
| retina, retina-night | a 1335x805 window at pixel ratio 2 (a Retina MacBook: the model about 1870x1610 device pixels), by day and at night |
| drag, drag-dpr2 | the mouse held down and dragged in slow sweeps across the view, a move every 16 ms |
| wheel, wheel-dpr2 | three mouse-wheel notches in, then three out, half a second apart |
| trackpad | a trackpad pinch: 45 small ctrl+wheel steps 16 ms apart, in then out |
| laptop-drag, laptop-wheel | drag and wheel at 1366x768 with the CPU slowed 4x |
| phone-touch | one-finger drag, then a two-finger pinch out and in, at 390x844@3 with the CPU slowed 4x |
| zoom-steps, zoom-steps-dpr1 | one zoom step at a time with 0.7 s after each: three wheel notches in, three out, the + and - keys, the + and - buttons; at the Retina size (starting from `z=1`) and at 1920x1080@1 |
| zoom-pinch | a trackpad pinch in, a pause, and out again (30 small ctrl+wheel steps each way); very slow under `--swgpu` |
| tiles-night, tiles-day | the Retina size from `z=1`, three wheel notches in and three out, at night (three layers a tile) and by day: for the per-tile table |

Columns: **fps**; **frame p50/p95/max**, the time between frames (ms); **work p50/p95**, the time spent inside the
model's `frame()` (ms); **long**, long tasks (over 50 ms); **tiles**, static tiles drawn while measuring; **heap MB**, JS
heap; **canvas MB**, an estimate of canvas backing memory (on-screen layers, tiles, scratch cards, ground texture and
shadow mask); **load KB** as served locally (no compression) and **gzip KB** as GitHub Pages sends it; **1st frame ms**,
from navigation to the first drawn frame. The second table splits the work by phase of `frame()`: `tiles` (laying the
static tiles on), `sim` (traffic, people, train and the list of moving things), `dyn` (drawing the moving things, with
their cut-outs), `blow` (blowing leaves and petals), `grade` (weather, colour grade, lit windows and glow), `tilt`
(tilt-shift blur), `sign` (the lantern clock and vignette), `labels`, and `zoom` (the step of a zoom glide, and the
landing: sizing the canvases for the new level).

The third table covers only the frames while a gesture is going on (and 0.3 s after each): the frame interval
p50/p95/p99/max and how many were over 50 and 100 ms; **tiles**, static tiles drawn whole inside one frame; **multi**,
frames that drew two or more; **max/frame**; **ms/tile** and **tile max**, what one such tile cost; **tiles in 1 frame
ms**, the most tile drawing done in a single frame (whole tiles plus tiles drawn a step at a time); **resize ms**, the
longest canvas resize on a zoom step; **glide frames**, frames drawn at an in-between scale while a zoom was on its
way; **stand-in frames**, frames at rest that showed a missing tile stretched from another scale, and **stand-in
after ms**, how long after the end of a gesture the last of those was. In software (headless),
tile drawing is lazy, so `?bench=flush` makes each new tile finish its drawing where it is counted.

A fourth table counts canvas calls per frame that are cheap in Chromium but not everywhere (the benchmark wraps the
canvas methods; the model is not involved): **src**, `drawImage` with a canvas as its source; **dirty**, those whose
source had been drawn on since it was last used as a source (the browser must finish drawing it, and WebKit often
copies it, before it can be read); **full**, draws, fills and clears covering half or more of a model-sized canvas;
**clip**, `clip()` calls; **filter**, draws with a canvas `filter` set.

A fifth table is per static tile drawn while measuring, counting only canvas calls whose destination is a canvas
that is not in the page (a tile or a scratch card): **copies**, `drawImage` from a canvas, and **dirty**, those from a
canvas just drawn on; **made**, canvases created; **sized**, canvases given a new size; **zeroed**, canvases set to
zero size (freed); **cards**, scratch cards used, as the model counts them; **ms**, JavaScript time per tile;
**late/ms**, how many ms later than due the next frame started per ms of tile drawing (only means something with a
graphics card); **cut**, how static things behind buildings were cut. It works on older builds (the columns they do
not record show `-`). Headless Chromium picks the software path, where tiles are cut on cards as before; add
`--query "compose=layers&cut=clip"` to count what a machine with a graphics card does.

The zoom scenarios add a table with a row per zoom step, covering the 0.7 s after it: **p50**, the usual time between
frames in that stretch; **worst**, the longest; **in frame()** and **outside**, how much of the worst one was the
model's own `frame()` and how much was not (the browser's own work, input handlers, waiting for the next frame);
**outside max**, the most time outside `frame()` between any two frames; **work max**, the longest `frame()`;
**handlers** and **fit**, the total time in the model's input handlers and in `fit()`; **glide** and **glide ms**, the
frames drawn at an in-between scale and how long they took; **landing** and **then**, the `frame()` time of the frame
that lands on the new level and the time until the next frame; **tiles**, **stand-in**; and **what happened** (the
zoom step, `landed`, a canvas resized, the blur restyled). The table works on older builds too (the columns they do
not record show `-`), which is how the before and after below were measured.

## Checking a real browser: `?fps`

Add `?fps` to the page address (the live site too) for a small box in the bottom-left corner: frames per second, the
time between frames, the time inside the model's `frame()` in total and per part (averaged over the last half
second), how many moving things are on screen and how many are cut out behind something, the tile cache, and the
browser, device pixel ratio, canvas size and which drawing path is in use. A screenshot of that box is all that is
needed to compare browsers. The time between frames is the one that counts: canvas work that the browser hands to
its graphics process (Safari does this) does not show in the per-part times. Without `?fps` none of it runs.

Line by line:

1. frames per second; the time between frames (and the longest); `work`, the time inside `frame()`; `outside
   frame()`, the time from the end of one `frame()` to the start of the next (the browser's own work, input handlers,
   and waiting): at 60 fps the two add up to 16.7 ms, and a long frame with little `work` shows up here.
2. the parts of `frame()`.
3. the time spent in the model's input handlers in the last half second (wheel, pointer, keys, the buttons, a
   resize) and the longest; the time in `fit()` (of it, `layers`: sizing canvases, `place`: styling the stacked
   elements).
4. tiles: how static things behind buildings are cut (`clip` or `card`) and how many scratch cards a tile took (the
   last 20 tiles); whether drawing ahead is on; tile canvases made, freed and reused in the last five seconds, and
   how many are spare.
5. what tile drawing costs the browser: the tile drawing done in the last five seconds and in how many frames; the
   **extra rest** after those frames (how much later than due the next frame started, over what frames without tile
   drawing show), in total and **per ms of tile work**; the same per frame, against frames without tile work; the
   tile allowance (how many ms a frame may spend drawing tiles just now, 1.5 to 12, and `every N frames` when it is
   spaced out) and how many frames it counted as stalled by tile drawing in the last half second.
6. the worst frame of the last five seconds, taken apart: the `frame()` time by part, the handlers, the rest (time
   that was nobody's on the page: the browser), `fit()`, and what happened in it: a zoom step (`zoom 1>1.5`), a
   landing (`landed`), a canvas resized (`canvas 714x556`), the blur restyled (`blur(1.92px)`), tiles drawn or
   finished, squares shown stretched, a glide in progress.
7. the last zoom: how many frames its glide had, in how long, and the longest of them; how long the frame that landed
   took; and the longest frame in the 0.6 s after the landing, with what happened in it.
8. to 10. moving things, the tile cache (megabytes include spare canvases), the browser, canvas size, scale and zoom, and the drawing path.

More flags pick the drawing path or switch one thing off, for comparing on the same machine:

| Address | What it does |
| --- | --- |
| `?fps` | the default path for the machine |
| `?fps&compose=canvas` | grade, blur and stacking done in the canvas (the old way), cut-outs by clipping (new) |
| `?fps&compose=canvas&cut=card` | all the old way: pixel for pixel what the model drew before the third pass |
| `?fps&compose=layers&cut=clip` | all the new way, even where the model would not choose it (a software renderer) |
| `?fps&tilemb=64` | tile cache capped at 64 MB (the default is 160, or 64 on touch devices) |
| `?fps&tilecut=card` | static things behind buildings cut on scratch cards when a tile is drawn (the old way; `tilecut=clip` forces the new way) |
| `?fps&ahead=0` | no drawing ahead: tiles are drawn only when the view needs them |
| `?fps&tilems=4` | the tile allowance pinned at 4 ms a frame (any number), whatever the frames do |
| `?fps&res=safe` | the resolution the model drew at before the sixth pass (no more than 2.6 million canvas pixels, no more than 2 canvas pixels per model pixel) |
| `?fps&res=sharp` | one canvas pixel per device pixel, whatever the frames do |
| `?fps&res=auto` | forget a remembered fallback and start over on sharp, watched |

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

## Dragging and zooming (second pass)

Measured with the gesture scenarios above, software drawing, same container, before and after run back to back.

**What made it janky.** Not the input handling: the pointer and wheel handlers only move the camera or change the
zoom level (a mouse move with hover hit-testing against cached building outlines: 0.06 ms; a wheel event that
changes the zoom level: 0.2 ms), and a zoom step's canvas resize is 1-7 ms. The hitches were new static tiles drawn all at once in the frame that needed them:

- **A zoom step changes the tile scale**, so every visible tile is new: 4 to 12 tiles in one frame (desktop at pixel
  ratio 2: 12 tiles, 572 ms of tile drawing in a single frame; the laptop with the CPU slowed 4x: 9 tiles, 1.8 s).
- **A drag** brings in a column or row of tiles at once: 2-4 tiles in one frame (100-160 ms in software).
- The 12 ms per-frame budget applied only to redrawing *stale* tiles; missing tiles were always drawn at once,
  because there was nothing to show in their place.

**What changed** (`public/model.js`, the static tiles section):

- `tileSteps`: a tile is drawn as a series of steps (ground and shadows, then one building, tree, lamp or parked car
  at a time); `renderTile` runs it straight through, exactly the drawing a tile always had. `work` advances a tile
  a step at a time until a deadline and keeps the part-drawn tile for the next frame.
- `drawAhead`, called at the end of each frame with what is left of ~10 ms (at least 2 ms): draws, in order, the
  whole model at half scale (12 tiles, kept for good: `OV`), the ring of tiles just outside the view, and the view at
  the next zoom level out and in. The cache size accounts for the ring so drawing ahead never evicts what it drew.
- `standInAt` / `drawStandIn`: when a frame needs a tile that is not drawn and another scale has that ground drawn,
  the frame draws the missing tile a step at a time within the 12 ms budget and, until it is done, shows the other
  scale's tiles stretched to fit. With nothing to stand in (only in the first seconds after load), the tile is drawn
  at once, as before.
- Exactness: how big the shared scratch cards have grown decides a few edge pixels' antialiasing, so drawing ahead
  uses scratch cards of its own sized from the shared ones, and when a tile drawn ahead comes into view the shared
  cards grow as drawing it there would have grown them (`growScr`). Every settled frame is identical to before.
- The table weave is laid only across the tile being drawn (it was the full model height for every tile).

**Visible during a gesture.** While a tile is missing at the new scale, its area shows the same ground from another
scale stretched to fit: slightly soft (upscaled from half or the neighbouring scale) or slightly sharper (downscaled),
for one to a few frames, only right after a zoom step or when a drag uncovers ground not drawn ahead. Measured: 1-4
frames per gesture on desktop when the model has had time to draw ahead, at most 24-28 frames over a whole six-step
wheel sequence at pixel ratio 2 or on the slowed laptop; the last stand-in was gone within 0-180 ms after the gesture
ended. Nothing else changes, and once settled the picture is the same pixel for pixel.

During gestures only (frame interval ms; **tiles**/**max** = whole tiles drawn inside a frame and the most in one
frame; **tile ms** = the most tile drawing in one frame). "After, warm" waited until drawing ahead had finished (about
40 s in software on desktop; it never finished within 60 s with the CPU slowed 4x); "after, cold" started 3 s after
load, like the "before" run:

| Scenario | before p95 / max | after cold | after warm | tiles / max before → warm | tile ms before → cold → warm |
| --- | --- | --- | --- | --- | --- |
| drag | 168 / 229 | 177 / 202 | 179 / 233 | 8 / 4 → 0 / 0 | 117 → 44 → 14 |
| wheel | 110 / 320 | 135 / 229 | 123 / 218 | 4 / 4 → 0 / 0 | 263 → 92 → 15 |
| trackpad | 123 / 207 | 138 / 283 | 123 / 183 | 4 / 4 → 0 / 0 | 156 → 96 → 12 |
| drag-dpr2 | 193 / 252 | 219 / 281 | 167 / 223 | 10 / 4 → 0 / 0 | 93 → 52 → 12 |
| wheel-dpr2 | 231 / 770 | 204 / 360 | 219 / 245 | 38 / 12 → 0 / 0 | 572 → 220 → 21 |
| laptop-drag | 432 / 481 | 421 / 450 | 411 / 432 | 6 / 3 → 4 / 2 | 159 → 151 → 169 |
| laptop-wheel | 576 / 2136 | 455 / 519 | 389 / 489 | 15 / 9 → 1 / 1 | 1758 → 255 → 155 |
| phone-touch | 755 / 1251 | 802 / 1195 | 876 / 1361 | 16 / 6 → 8 / 4 | 945 → 457 → 542 |

The worst frames and the tile hitches are gone on desktop; the typical frame interval during a gesture did not move,
because in software it is the same per-frame cost as standing still (the tilt-shift blur alone is ~80 ms here). The
slowed phone does not get time to draw ahead in software, so it still draws tiles whole after a pinch.

On the graphics-card path (`--swgpu`: canvases through SwiftShader, so frame intervals are meaningless but the
main-thread work is real), the mean `tiles` phase during gestures went from 18.8 → 8.6 ms (drag), 9.7 → 4.8 (wheel),
23.9 → 12.8 (drag-dpr2) and 298 → 16.8 ms (wheel-dpr2), and the p95 of `frame()` work on wheel-dpr2 from 337 → 44 ms.

Standing still (software, fps and frame p50, before → after): desktop 8.7 → 8.2 / 108 → 114, desktop-dpr2 7.9 → 7.4 /
121 → 129, zoomed-in 58.2 → 57.7 / 16.7 → 16.7, zoomed-out 7.0 → 7.0 / 131 → 129, laptop-4x 3.0 → 2.9 / 316 → 330,
phone-4x 1.5 → 1.5 / 675 → 694: the same within run-to-run noise (the unchanged tilt-shift phase moved by as much).
The cost is memory and a few seconds of background drawing after load: canvas memory goes up by the half-scale model
and the ring (desktop 45.7 → 50.7 MB; zoomed-in 7.8 → 29.8 MB, still less than the other views), and until drawing
ahead is done each frame spends up to ~10 ms on it (at least 2 ms).

## Safari, and less work per frame everywhere (third pass)

A screen recording on a Retina Mac showed Safari updating the model 6 to 8 times a second all the time, standing still
or dragging, while Chrome on the same machine was much smoother. The first two passes were measured in Chromium only.
No WebKit could be run here, so this pass works from the calls a frame makes and from how WebKit is known to treat
them; `?fps` (above) is there to check the result in Safari.

**What a frame did** at the Retina size, counted by the benchmark (before → after, per frame):

| | retina (day) | retina-night | desktop | zoomed-out |
| --- | --- | --- | --- | --- |
| `drawImage` from a canvas | 716 → 17 | 644 → 49 | 426 → 20 | 1864 → 21 |
| ...from a canvas just drawn on | 269 → 11 | 315 → 12 | 153 → 8 | 677 → 9 |
| full-canvas draws, fills, clears | 10 → 4 | 11 → 5 | 10 → 4 | 10 → 4 |
| draws with a canvas filter | 3 → 0 | 3 → 0 | 3 → 0 | 3 → 0 |
| `clip()` calls | 0 → 290 | 0 → 619 | 0 → 186 | 0 → 1118 |

(The few canvas-source draws left are the static tiles laid on the picture; the "just drawn on" ones are tiles being
drawn ahead during the measurement, and stop when that is done.)

**The Safari costs, most likely first, and what was done:**

1. *A scratch card per moving thing* (removed). Every car and person behind something was drawn on a small card,
   the outlines in front were rubbed out of it, the card rubbed out the lit-window and glow layers, and it was copied
   onto the picture: per thing, two to five `drawImage` calls whose source canvas had just been drawn on, about 270 a
   frame at the Retina size. In WebKit a canvas that is drawn on and then read as an image has to be flushed and
   usually copied each time. Now each thing is drawn straight onto the picture under a clip that is everything
   except the outlines in front (`invOf`, `unionOutline` in `public/model.js`), so nothing is read back.
2. *Reading the visible canvas back for the tilt-shift, and canvas filters* (removed where there is a graphics card).
   The blur drew the visible canvas into another canvas through `filter: blur()` twice a frame, and the colour grade
   drew the whole picture through `filter: saturate()`. Canvas filters are new in Safari and slow there; older Safari
   has none, and showed no blur or saturation at all. Now the browser's compositor does both (see below).
3. *Whole-canvas passes* (10 → 4 a frame). The picture was drawn on a hidden canvas and copied to the visible one,
   with the lit-window and glow canvases copied on top (three whole-canvas `drawImage` calls from canvases just drawn
   on), plus clears of all three and the blur passes. Now the picture is drawn on the visible canvas itself; the
   lit-window and glow layers are visible canvases stacked on it; a blank layer is not cleared or laid on again.
4. *Many canvases* (bounded). Each tile is up to three canvases. The tile cache is now capped in megabytes as well as
   in count (160 MB, 64 MB on touch devices; `TILE_MB`), drawing ahead stops short of the cap, the half-scale copy
   of the whole model is skipped when it would not fit in a quarter of it, and a dropped tile gives its memory back
   at once (its canvases are set to zero size) instead of waiting for the garbage collector, which Safari needs.
   The glow canvas exists only while something glows, and the four hidden full-size canvases are gone.
5. *Rubbing out on blank layers* (removed). Every polygon of every moving thing was also rubbed out of the lit-window
   and glow layers, which by day have nothing on them there: three fills per polygon became one.

**How a frame is put together now** (`LY`, `makeLayers`, `placeLayers`, the end of `frame()`): the picture goes
straight onto the visible canvas. On top of it, in order: a `mix-blend-mode: multiply` element and a
`plus-lighter` element (the grade's multiply and add), the storm flash, the lit-window canvas, the glow canvas
(`plus-lighter`), two elements with `backdrop-filter: blur()` under a fading `mask-image` (the tilt-shift), the
vignette (a CSS radial gradient), and one more canvas for the lantern sign and the labels, so they stay sharp. The
canvas itself has `filter: saturate()`. All of it is the compositor's work, on the graphics card; the frame only
changes a style when its value changes.

**Moving things:** a thing wholly behind one building is not drawn at all; outlines are tested exactly against the
thing's box (`boxVsLoops`) before they are used, which more than halved the clips; the lit-window layer is clipped
and rubbed out only when the thing paints there or something already painted there is under it; the scan for
buildings in front uses a coarse grid (`bldsNear`) instead of every building for every thing.

**Without a graphics card** (a software renderer, which the model detects from the WebGL renderer name) the
compositor's blur and the clipping cost more than the old way did, so such a machine keeps the old way throughout,
pixel for pixel as before. This is also what the headless benchmark runs by default; `--swgpu` forces the new path.

**Chromium, graphics-card path** (`--swgpu`; time inside `frame()` per frame, p50 / p95 ms, and the `dyn` part):

| Scenario | work before → after | dyn before → after |
| --- | --- | --- |
| retina (1870x1610 device px) | 32.0 / 46.1 → 12.9 / 23.3 | 34.2 → 6.6 |
| retina-night | 25.6 / 36.8 → 10.6 / 15.1 | 25.7 → 6.7 |
| desktop | 25.2 / 46.9 → 12.3 / 20.4 | 30.2 → 7.1 |
| desktop-dpr2 | 28.7 / 41.9 → 12.2 / 19.1 | 29.0 → 6.9 |
| zoomed-in | 5.6 / 10.6 → 10.0 / 12.8 | 4.3 → 0.8 |
| zoomed-out | 45.2 / 67.0 → 20.6 / 20.6 | 53.2 → 15.8 |
| pan-zoom | 19.0 / 32.8 → 10.2 / 21.6 | 15.7 → 3.4 |
| laptop-4x | 138.3 / 233.9 → 26.4 / 49.8 | 144.5 → 22.1 |
| phone-4x | 62.3 / 93.4 → 18.6 / 32.4 | 74.9 → 15.1 |

The "after" work includes 2 to 7 ms a frame of drawing ahead, which was still going during the 8 seconds measured
(zoomed-in is higher than before for that reason alone) and stops once it is done. On the same build, the retina
scenario with the old path forced (`compose=canvas&cut=card`) measures 33.8 / 44.5 ms, and with only the cut-outs
changed (`compose=canvas`) 14.5 / 24.4 ms. Software drawing (the default headless run) is unchanged, as it runs the
old path: retina 14.2 → 14.0 fps, desktop 8.9 → 9.5, zoomed-out 7.4 → 8.5, zoomed-in 57.9 → 56.8.

**The picture.** It no longer has to be identical, only the same to the eye. Against the original, the new path
differs by under 1 level of 255 on average: about half the pixels change by one or two levels (the compositor's
saturate and blur round differently), 0.03% to 0.7% of pixels by more than 8, and a hundred or two by more than 32
(antialiased edges where a moving thing is cut out). Known differences:

- The blur is done on the picture as shown rather than on the canvas pixels, so at high zoom the blurred bands are
  smooth where they used to show blurred blocks.
- The lantern sign sat under the vignette and now sits over it; it is given the vignette's share itself.
- Browsers whose canvas has no `filter` (older Safari) now get the saturation and the tilt-shift they never had.
- A wall of a car facing a certain way can show a different colour than before. That is an old bug, not a new one:
  `mix()` makes an invalid colour for walls facing the light most directly (the shade factor goes below zero), the
  canvas ignores it and the wall takes whatever colour was used last. Which colour that is has changed. Not fixed
  here, because fixing it would also change those walls on buildings.

**Not verified** (no Safari here): that Safari is in fact faster and by how much; that `backdrop-filter` under a
mask, `plus-lighter` and `multiply` over canvases composite in Safari as they do in Chromium (they are all supported
there; the model falls back to the canvas path if the browser reports they are not); how expensive several hundred
`clip()` calls a frame are in Safari (the fallback `?cut=card` is there to compare); and Safari's canvas memory
ceiling. Open the site with `?fps` in Safari, then with `?fps&compose=canvas&cut=card`, and compare the boxes.

## Zooming (fourth pass)

After the third pass Safari held 60 fps standing still and dragging (frame 16.7 ms, 1.4 to 3.2 ms of it in `frame()`),
but each zoom step showed one or two long frames (76 to 101 ms) with almost none of that time inside `frame()`, and the
picture jumped 1.4x to 1.5x in a single frame. No WebKit could be run here, so, as before, the Safari part works from
what a zoom step did and `?fps` is there to check it.

**What a zoom step did, and what it does now.** `zoomBy` called `fit(true)` at once, from the input handler:

| At every zoom step, before | Now |
| --- | --- |
| the label canvas (as big as the screen in device pixels: 2140x1666 in the window recorded) was given its width and height again, which throws its backing store away and makes a new one, though its size never depends on the zoom | sized only when the box or the pixel ratio changes |
| 47 style assignments on the nine stacked elements (position and size of each, though unchanged; the blur radius of both tilt-shift bands; the vignette) | none at the step and none while it glides; the blur radius (and the vignette, if the canvas changed shape) three frames after the landing; positions only when the box moves |
| the canvas box was measured again after those writes (`offsetWidth` and friends, then `getBoundingClientRect` from the buttons' `canZoom`), so the browser laid the page out inside the handler; and once more every frame for drawing ahead | measured once and again only when the box or the pixel ratio changes (`geo()`): no layout read in a zoom step or in a frame |
| the glow canvas was shrunk to 1x1 and made full size again whenever the last glowing thing left and re-entered the view | keeps its size for ten seconds after the last glow |
| every tile in view was new (another scale): the view at the next level was mostly never drawn ahead, because the ring round the view came first and used up the allowance (at the recorded size: room for 3 of the ~18 tiles of the two neighbouring levels). So each step drew 6 to 12 tiles in the frames after it, 12 ms a frame in `frame()` and more in the browser's graphics process | the cache has room for the ring and the view at both neighbouring levels; after a zoom step the next level the same way is drawn before the ring; and while a zoom glides, the tiles it will land on come first |
| tile drawing took up to 12 ms of every frame (10 ahead) whatever the browser's graphics process made of it | the allowance follows the frames: a frame that starts late (more than a frame and a half after the last one ended) halves it, down to 3 ms; each frame on time gives 0.5 ms back, up to 12 (`tileBudget`); reworked in the fifth pass, below |

Measured in Chromium (layers path, 1335x805@2, counting calls for one wheel notch and the 0.9 s after it): canvas size
assignments 2 → 0, layout reads 15 to 27 → 0 (one of them forced straight after writes → 0). In Chromium none of this
was ever expensive: the handlers of a zoom step take 0.1 to 0.7 ms now (a wheel event that changed the level took
0.2 ms when measured in the second pass) and `fit()` under 1 ms, before and after. Which of
them cost Safari its 80 ms is **not known**; the label canvas (new on main since the third pass, reallocated at full
screen resolution on every step) and the burst of new tiles are the likeliest, the blur restyle after that. They are
now in different frames, so the `?fps` box will say which, if any is left: see "the last zoom" line.

**The glide.** The zoom still rests only on the ten levels, but gets from one to the next in 180 ms, fast at first and
easing out, about the middle of the view (the same anchor as the jump had). How it is done (`ZG`, `zoomBy`,
`zoomFrame`, `land` in `public/model.js`): the scale and the camera are worked out for each frame, and the frame is
drawn at that in-between scale like any other, except that the static picture is laid on from tiles already made at
other scales, stretched to fit (`standInAt`): no tile is ever drawn at an in-between scale. Cars, people, the train,
flags, leaves, the lit windows and glow, the lantern sign and the labels are drawn at the in-between scale directly,
by the same code as at rest, so nothing can drift out of register. The frame that reaches the end lands: it switches
to the level's own scale (and canvas size, where the level needs another), exactly where a jump would have put it.

What it looks like:

- *A wheel notch, a key, a button:* the model grows or shrinks smoothly for 180 ms (about 10 frames at 60 fps) and
  stops. On the way in, the ground and buildings are the old level's tiles enlarged (slightly soft) until about
  halfway, then the new level's tiles reduced (sharp), if those were drawn ahead, which they usually are; on the way
  out, the old tiles reduced, with the rim of the view from the new level or, failing that, from the half-scale copy
  of the whole model (softer). Moving things stay sharp throughout and keep moving.
- *Labels and signposts* keep their size and slide with their buildings; names appear or drop out on the way as the
  scale passes the points where they would at rest.
- *The blurred bands and the vignette* stay where they are on screen. The blur keeps the old level's radius during
  the glide and takes the new one 50 ms after landing: a small change in how soft the top and bottom bands are.
- *Several notches in a row:* each one retargets the glide from where it is, 180 ms from the last notch, so a spin
  of the wheel is one continuous movement.
- *A pinch* (two fingers on a touch screen; on a trackpad, ctrl+wheel in Chrome, Firefox and Edge, gesture events in
  Safari) drives the scale directly, between the furthest levels allowed, and when the fingers lift it glides to the
  nearest level. It used to step a level each time the fingers had spread by 1.4x.
- *Reduced motion* (`prefers-reduced-motion: reduce`): no glide, the zoom jumps as before.
- *A slow machine:* the glide lasts 180 ms however long a frame takes, so with software drawing (60 to 110 ms a
  frame here) it is one to three in-between frames.
- Starting a drag, pressing an arrow key or using the pan and home buttons while a zoom glides lands it at once.
  The camera still never moves without input: the only motion added is the 180 ms after a zoom input (140 ms more
  after the last ctrl+wheel event of a trackpad pinch, which is how the end of one is known).

**At rest the picture is the same as before.** Stepping frames by hand with a fixed clock and seeded random numbers
(layers path), 19 views after wheel, key, button and drag sequences at pixel ratio 1, 2 and 3, day and night, with
and without labels: 17 identical to main pixel for pixel, one (three quick notches out) different in 6 pixels by at
most 2 levels (the order tiles were drawn in), and the November view with wind different only in where the blowing
leaves are (their random numbers depend on which trees were on screen during the glide). With reduced motion (4
views) and on the canvas path (5 views), identical. Two things other than the glide differ on purpose: rain, snow and pollen are
re-scattered when a zoom lands rather than when it starts, and the cache keeps more tiles (at the recorded size, up to
about 51 instead of 32, some 20 MB more by day; the megabyte cap is unchanged).

**Numbers** (same container, before and after back to back; before = main at 22c2cbe run with the new benchmark):

| | before | after |
| --- | --- | --- |
| `--swgpu` zoom-steps (Retina size): mean `tiles` part of `frame()` | 7.1 ms | 1.5 ms |
| `--swgpu` zoom-steps: `frame()` p50 / p95 | 18.6 / 30.4 ms | 13.8 / 24.4 ms |
| `--swgpu` zoom-steps: longest `frame()` in the 0.7 s after a step, median / max over the steps | 29 / 69 ms | 17 / 51 ms |
| `--swgpu` zoom-steps-dpr1: mean `tiles` part, `frame()` p50 / p95 | 10.4 ms, 20.3 / 29.5 | 2.1 ms, 10.1 / 23.2 |
| `--swgpu`: `fit()` per step, median / max | 0.4 / 1.0 ms | 0.25 / 0.9 ms |
| `--swgpu`: frames after a step still showing a stretched square | 0 to 8 | 0 to 3 |
| `--swgpu`: in-between frames per step | none | 1 to 5 |
| software, wheel: interval p95 / max during the gesture | 107 / 168 ms | 105 / 189 ms |
| software, wheel-dpr2 | 157 / 300 | 157 / 304 |
| software, laptop-wheel (CPU slowed 4x) | 404 / 547 | 438 / 666 |
| software, trackpad pinch: p50 / p95 / max | 31 / 132 / 233 | 69 / 123 / 205 |
| software, phone-touch (CPU slowed 4x): p50 / p95 / max | 253 / 690 / 977 | 540 / 738 / 859 |
| software, standing still: desktop, retina fps | 9.9, 15.5 | 9.4, 14.7 |

Read them with the graphics card caveat in mind. Under `--swgpu` the time *between* frames is SwiftShader painting
tiles, one to seven seconds at a time on both builds, so "worst frame per step" and "time outside `frame()`" are
reported by the zoom table but mean nothing on this container (medians 3.8 s before, 2.6 s after); they are there
for `--headed` on a real machine. The main-thread numbers are real: less tile drawing lands in the frames after a
step, partly because the next level is ready more often and partly because the allowance backs off when frames come
late, which under SwiftShader is always. In software the frame costs what the view costs, glide or no glide: the
pinch p50 went up because a pinch now draws every frame at the scale the fingers are at (near the opening view,
60 to 110 ms a frame here) where it used to jump to deep zoom, where frames are cheap; one frame at a given scale
costs the same as before. The other differences are run-to-run noise.

**Not verified** (no Safari here):

- that the long frame at a zoom step is gone in Safari, and which of the causes above it was;
- that drawing some twenty tiles stretched, every frame of a glide, is as cheap in Safari's canvas as it is in
  Chromium's (it is the same call the model made before for a missing tile, on at most a few frames; now it is every
  glide frame). If glide frames are long in Safari, "the last zoom" line shows it (`longest` during the glide);
- trackpad pinch in Safari: it sends `gesturestart` / `gesturechange` / `gestureend` rather than ctrl+wheel. The
  model now handles them (and stops Safari magnifying the page while the pointer is over the model); tested only
  with made-up events in Chromium;
- whether changing a `backdrop-filter` radius is expensive in Safari (it is now alone in its frame, three frames
  after the landing, and shows as `blur(...)` in the readout if that frame is long);
- real touch pinches on a phone (tested with synthetic touches at 390x844@3).

To check in Safari: open the site with `?fps`, zoom a step, and screenshot the box. "the last zoom" gives the glide's
frame count and longest frame, the landing frame, and the longest frame after it with what happened in it; "worst
frame of the last 5 s" gives the same breakdown for whatever was longest.

## Tile drawing and the browser's graphics process (fifth pass)

With `?fps` on, Safari 27.2 on a Retina MacBook at night held 60 fps standing still and through zoom glides, and
every bad frame that was left was "rest": time in nobody's JavaScript, in frames where a little tile drawing had been
done (43 ms with 2 ms of tile work, 90 ms after a landing with 4 ms, 72 ms with 2 ms and no tile finished), the tile
allowance sitting at its floor of 3 ms with 23 to 31 late frames after each zoom. So 2 to 4 ms of tile drawing in
`frame()` bought 40 to 85 ms of work in Safari's graphics process, and backing the allowance off in JavaScript
milliseconds could not fix that. This pass makes a millisecond of tile drawing cheaper for the browser, and keeps it
out of frames the user is watching. There is no Safari on the machine this was written on: what follows was measured
in Chromium, and the list at the end says what that leaves open.

**What a tile cost, and what it costs now**

| What a tile did | Now |
| --- | --- |
| every tree, lamp, parked car, string of lights or fountain partly behind a building was drawn on a scratch card, the buildings rubbed out of it, and the card copied onto the tile's layers: at night about 110 canvas-to-canvas copies a tile, 45 of them from a card drawn on a moment before (the pattern that makes WebKit finish and copy the source first), three layers | drawn straight onto the tile under a clip: its box, less each building in front whose outline really reaches it (`clipPoint`; the same test and the same inverse outlines the moving things have used since the third pass). No card, no copy. What is left is one copy of the ground texture and, by day, one of the shadow mask per tile, from canvases that are never drawn on again |
| each new tile made three 512x512 canvases, and each tile dropped from the cache set its three to zero size: with the cache at its cap (it sat at 127 to 158 MB of 160), three made and three freed for every tile drawn | canvases are pooled (`takeCanvas`, `dropTile`): at the cap the oldest tile hands its canvases over before the new tile starts (`makeRoom`), so the new one is drawn on those. Up to 24 spares are kept; they count toward the cap |
| a layer with nothing on it (no lit window, no glow) was resized to 1x1, and back when the tile was redrawn | its canvas goes back to the pool as it is, and the tile points at one shared blank (`NIL`) |
| in a cache too small for what drawing ahead asked for (found with `?tilemb=56`: the tiles at the half-scale copy's scale are never dropped and had most of the room), drawing ahead pushed out its own tiles and drew them again, a tile every few frames for as long as the page stood still | drawing ahead stops when the tile it would push out is one it is asking for (`roomAhead`) |
| a tile standing in for one not drawn yet could be dropped to make room for it | tiles laid on the screen in this frame or the last are not dropped (`t.use`) |

Where the model finds a software renderer it still cuts on cards, as it does for moving things (clipping is the slow
way there); `?tilecut=card` or `?tilecut=clip` forces either.

**When tiles are drawn** (`tileBudget`, and the end of `frame()`):

- *Dragging:* nothing is drawn ahead while the pointer is down. Ground the drag uncovers is still drawn in the
  frame, within the allowance, with a stand-in until it is done.
- *A zoom glide:* only the tiles it will land on, 2 ms a frame at most, and none for the rest of the glide once a
  frame of it has stalled.
- *After a landing or a drag:* the allowance starts again from 2 ms and grows a quarter of a millisecond for every
  frame of tile drawing that does not stall, up to 12.
- *A stall* is judged by the rest, not by lateness alone: for every frame the model works out how much later than
  due the next one started, given how long `frame()` itself took (the "extra rest"). After a frame that drew tiles,
  extra rest of more than half a frame over what frames without tile drawing show halves the allowance, down to
  1.5 ms; at 1.5 ms, tile drawing is spaced out instead: every second frame, every fourth, up to every ninth.
- The allowance is also kept to what fits in a frame beside the rest of `frame()`'s work.

The readout shows all of it: `tile work X ms in N frames of the last 5 s, extra rest after them Y ms = Z ms of rest
per ms of tile work`. On a machine where tile drawing is free for the browser Z is near 0; Safari before this pass
was at about 20 to 40.

**The picture.** Stepping frames by hand with a fixed clock and seeded random numbers, 15 views (day, dusk, night,
November, March, five zoom levels, pixel ratio 1, 2 and 3, after wheel and drag sequences): with static things cut
by clip, 0.1 to 0.4 % of the pixels differ from main, all along the cut edges of things behind buildings (a clip
edge is antialiased slightly differently from a rubbed-out card edge): at most 64 pixels in a view differ by more
than 32 levels of 255, the largest single difference 82. With `?tilecut=card` on the same path (8 views) and on the
software path (4 views) the picture is main's pixel for pixel, except 11 pixels by one level in one view after three
wheel notches (tiles were drawn ahead in a different order).

**Numbers** (same container; before = main at cc1b6bd run with the new benchmark; `npm run bench -- --only tiles
--query "compose=layers&cut=clip"`, so the path a graphics card gets, drawn in software: the counts do not depend on
the renderer):

| per static tile drawn | before | after |
| --- | --- | --- |
| tiles-night: canvas-to-canvas copies, of them from a canvas just drawn on | 113.7, 45.3 | 1.0, 0 |
| tiles-day: the same | 37.4, 35.4 | 2.0, 0 |
| tiles-night: canvases made / resized / freed | 3.2 / 0.2 / 1.7 | 2.2 / 0 / 0 (the cache still filling) |
| tiles-day: canvases made / resized / freed | 3.0 / 2.0 / 2.3 | 0.5 / 0 / 0 |
| tiles-night with `tilemb=56` (the view alone near the cap): copies, made / freed | 197, 3.3 / 2.6 | 1.3, 1.6 / 0.8 |
| the same, standing still after one zoom step: tiles drawn | about 13 every 2 s, without end | none |
| JavaScript ms per tile, night / day | 17.2 / 14.3 | 13.3 / 9.1 |
| after, with `?tilecut=card`: copies, from a canvas just drawn on, cards a tile (night) | | 154.7, 62.9, 46.5 |

Under `--swgpu` only three to five tiles get drawn in a run (SwiftShader takes seconds over each), with the same
counts: 113 copies a tile, 43 of them dirty, before; 1.8 and none after. On the software path the model picks for
itself nothing changes in how a tile is drawn. Dragging there now shows more frames with a stand-in square (20
against 6 in the `drag` scenario) because nothing is drawn ahead while the pointer is down, and the most tile
drawing in one frame of a drag fell from 17 ms to 5; wheel and zoom-step intervals are the same within noise
(wheel p95 70 ms against 86, zoom-steps 64 against 69).

**Visible differences:** edges of trees, lamps and parked cars where a building cuts them may differ by a faint
antialiasing pixel. After a long drag onto ground not seen before, the rim of the view can be soft (a stand-in) for
a few frames more than before, since drawing ahead waits for the pointer to lift. Nothing else.

**Not verified** (no Safari here):

- that WebKit's graphics process finds a few hundred clipped fills cheaper than the card copies. It is the same
  kind of drawing the moving things have done every frame since the third pass, at 60 fps in Safari, which is the
  reason to expect so; the readout's "ms of rest per ms of tile work" is the number that says. If it is still high,
  compare `?fps&tilecut=card` (the old cut, with the pool and the new timing), `?fps&ahead=0` (does the stall come
  from drawing ahead at all) and `?fps&tilems=2` against `?fps&tilems=8` (is a stall a matter of how much is drawn
  in a frame, or of drawing on a tile canvas at all: if the second, fewer and bigger helpings are the answer, and
  the spacing already does that at the floor);
- that reusing a canvas is cheaper in WebKit than making one (it avoids allocating and freeing an accelerated
  backing store per tile, which is the usual cost), and that 24 spare canvases (24 MB) sit well with Safari's canvas
  memory limit: they are inside `TILE_MB`;
- the stall test against Safari's real frame pacing (ProMotion, a throttled tab, low power mode). The baseline it
  compares with is measured, not assumed, so a display that is not 60 Hz should be fine; not seen;
- two suspects left alone: each lamp's glow is a radial gradient made when its tile is drawn (a handful per tile, at
  night only), and a tile is three layers at night. If "rest per ms of tile work" stays high by night and not by
  day, those are next.

To check in Safari: open the site at night with `?fps`, zoom a step or two, drag, and screenshot the box. Lines 4
and 5 carry what this pass is about.

## Resolution (sixth pass)

The complaint: the model looked low-resolution and grainy in a 2519 px wide Chrome window on a 2560x1440 monitor.

**Cause.** The canvas was capped at 2.6 million pixels, and each canvas pixel is a whole number of device pixels, so a
window whose model area was over the cap (2119x1234 here, 2.61 million) was drawn at half the screen's resolution each
way, a quarter of the pixels, and stretched. Zoomed out one step from the opening view the model was drawn at half a
canvas pixel per model pixel and doubled. A second cap (2 canvas pixels per model pixel) did the same at the three
closest zoom levels on any screen: half resolution at zoom 3 and 4, a third at zoom 6. A Retina MacBook window (about
1870x1610 device pixels and up) was over the pixel cap too, so it showed one canvas pixel per CSS pixel.

**What changed.** Two resolution plans in `model.js` (see "view size and zoom" there):

- **sharp**, the default where there is a graphics card: one canvas pixel per device pixel at every zoom level, up to
  6 million canvas pixels (past that, a 4K screen filled edge to edge, it halves as before). Touch devices keep the
  2.6 million pixel cap (they have less canvas memory) but lose the 2-per-model-pixel cap.
- **safe**: exactly what the model did before. A software renderer starts here.

Sharp draws up to four times the pixels (nine at the closest zoom). The model's own work per frame does not depend on
the pixel count (the paths are the same; measured below), but the graphics card's does, and that cannot be measured
in this container. So a governor (`resGov`) watches the time between frames whenever the two plans differ for the
view: the middle value of 120 frames at rest or dragging (frames that drew tiles and zoom glides are left out). Two
windows running over 21 ms (under about 48 fps) and it switches to safe, throws away one window while the canvas
settles, and compares the next: if safe is at least a fifth faster it stays, and the device remembers that for a week
(`localStorage` key `gso-res`); if not, the pixels were not what was slow, so it goes back to sharp and stops watching.
The worst case is therefore a few seconds of slower frames once a week on a machine that cannot afford sharp, and
after that the same picture and speed as before. A 120 Hz screen held at a steady 60 is not noticed.

A side effect: with one canvas pixel per device pixel at every level, a zoom step no longer changes the size of the
canvas, so the resize that used to land with some zoom steps (see the fourth pass) is gone under sharp.

**Measured** (headless Chromium with `--swgpu`, 6 s; the frame rates of that software graphics card mean nothing, the
time inside `frame()` does):

| | safe (before) | sharp |
| --- | --- | --- |
| retina, canvas | 935x805 | 1870x1610 |
| retina, `frame()` p50 / p95 ms | 12.8 / 17.3 | 14.0 / 19.3 |
| retina, `dyn` ms | 5.48 | 4.79 |
| retina, canvas memory MB | 50.5 | 102.3 |
| zoomed-in (z 6), canvas | 507x360 | 1520x1080 |
| zoomed-in, `frame()` p50 / p95 ms | 2.6 / 8.0 | 2.7 / 7.3 |
| zoomed-in, canvas memory MB | 39 | 81.7 |

The governor was tried on the software renderer with `?res=auto` at 2519x1234: sharp ran at 176 ms a frame, it
switched after 9 s, measured safe at 65 ms, stayed on safe and stored it.

**Not checked:** a real graphics card and Safari. `?fps` shows the plan in its last line (`res: sharp (default,
watching)`), and `?fps&res=safe` against `?fps&res=sharp` compares the two on any machine.

## What is left, and whether to change engines

- **After the fifth pass** a tile is drawn without copying from a canvas just drawn on and without making or freeing one, and
  tile drawing keeps out of drags and glides. If Safari still stalls after tile drawing, the `?fps` box says how
  much per millisecond, and `?tilecut=card`, `?ahead=0` and `?tilems=N` narrow down why.

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
- **After the fourth pass** a zoom step no longer resizes or restyles anything it does not have to, and glides.
  If Safari still shows a long frame at a step, the `?fps` box now says what was in it.
- **After the third pass** the cut-out cards are gone: `dyn` is 7 ms where it was 30 on the graphics-card path, and
  most of what is left is the model's own arithmetic and a few hundred clipped fills.
- **After the second pass**, dragging and zooming cost the same per frame as standing still, so a gesture is as
  smooth as the steady frame rate. What remains per frame on a graphics card is the model's own JavaScript, mostly the
  cut-out cards (`dyn`, ~10-25 ms at 1920x1080 on the `--swgpu` path). WebGL would make that nearly free (the GPU
  sorts by depth instead of cutting cards) and would draw tiles as textures, but it is a rewrite of the drawing code
  (weeks, not days), and every outline, antialiased edge and blend would have to be re-matched by eye: the picture
  would no longer be pixel-identical. Measure `npm run bench -- --headed --only interaction` on the real machine first.
