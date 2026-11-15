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

Columns: **fps**; **frame p50/p95/max**, the time between frames (ms); **work p50/p95**, the time spent inside the
model's `frame()` (ms); **long**, long tasks (over 50 ms); **tiles**, static tiles drawn while measuring; **heap MB**, JS
heap; **canvas MB**, an estimate of canvas backing memory (on-screen layers, tiles, scratch cards, ground texture and
shadow mask); **load KB** as served locally (no compression) and **gzip KB** as GitHub Pages sends it; **1st frame ms**,
from navigation to the first drawn frame. The second table splits the work by phase of `frame()`: `tiles` (laying the
static tiles on), `sim` (traffic, people, train and the list of moving things), `dyn` (drawing the moving things, with
their cut-outs), `blow` (blowing leaves and petals), `grade` (weather, colour grade, lit windows and glow), `tilt`
(tilt-shift blur), `sign` (the lantern clock and vignette), `labels`.

The third table covers only the frames while a gesture is going on (and 0.3 s after each): the frame interval
p50/p95/p99/max and how many were over 50 and 100 ms; **tiles**, static tiles drawn whole inside one frame; **multi**,
frames that drew two or more; **max/frame**; **ms/tile** and **tile max**, what one such tile cost; **tiles in 1 frame
ms**, the most tile drawing done in a single frame (whole tiles plus tiles drawn a step at a time); **resize ms**, the
longest canvas resize on a zoom step; **stand-in frames**, frames that showed a missing tile stretched from another
scale, and **stand-in after ms**, how long after the end of a gesture the last of those was. In software (headless),
tile drawing is lazy, so `?bench=flush` makes each new tile finish its drawing where it is counted.

A fourth table counts canvas calls per frame that are cheap in Chromium but not everywhere (the benchmark wraps the
canvas methods; the model is not involved): **src**, `drawImage` with a canvas as its source; **dirty**, those whose
source had been drawn on since it was last used as a source (the browser must finish drawing it, and WebKit often
copies it, before it can be read); **full**, draws, fills and clears covering half or more of a model-sized canvas;
**clip**, `clip()` calls; **filter**, draws with a canvas `filter` set.

## Checking a real browser: `?fps`

Add `?fps` to the page address (the live site too) for a small box in the bottom-left corner: frames per second, the
time between frames, the time inside the model's `frame()` in total and per part (averaged over the last half
second), how many moving things are on screen and how many are cut out behind something, the tile cache, and the
browser, device pixel ratio, canvas size and which drawing path is in use. A screenshot of that box is all that is
needed to compare browsers. The time between frames is the one that counts: canvas work that the browser hands to
its graphics process (Safari does this) does not show in the per-part times. Without `?fps` none of it runs.

Two more flags pick the drawing path, for comparing on the same machine:

| Address | What it does |
| --- | --- |
| `?fps` | the default path for the machine |
| `?fps&compose=canvas` | grade, blur and stacking done in the canvas (the old way), cut-outs by clipping (new) |
| `?fps&compose=canvas&cut=card` | all the old way: pixel for pixel what the model drew before the third pass |
| `?fps&compose=layers&cut=clip` | all the new way, even where the model would not choose it (a software renderer) |
| `?fps&tilemb=64` | tile cache capped at 64 MB (the default is 160, or 64 on touch devices) |

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
- **After the third pass** the cut-out cards are gone: `dyn` is 7 ms where it was 30 on the graphics-card path, and
  most of what is left is the model's own arithmetic and a few hundred clipped fills.
- **After the second pass**, dragging and zooming cost the same per frame as standing still, so a gesture is as
  smooth as the steady frame rate. What remains per frame on a graphics card is the model's own JavaScript, mostly the
  cut-out cards (`dyn`, ~10-25 ms at 1920x1080 on the `--swgpu` path). WebGL would make that nearly free (the GPU
  sorts by depth instead of cutting cards) and would draw tiles as textures, but it is a rewrite of the drawing code
  (weeks, not days), and every outline, antialiased edge and blend would have to be re-matched by eye: the picture
  would no longer be pixel-identical. Measure `npm run bench -- --headed --only interaction` on the real machine first.
