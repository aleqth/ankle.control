# ankle.control — session handover (2026-05-20 evening)

The previous agent (Claude Opus 4.7) ran low on context. This doc carries
state forward so the next agent can pick up cleanly.

## What this project is

`aleqth.github.io/ankle.control/` — a single-page GitHub Pages tool that
takes any reference image and re-builds it as either
(a) a 2D mosaic of an uploaded asset PNG (`mosaic.js`), or
(b) a 3D field of instanced asset planes whose per-cell scale, depth, and
color are driven by sampled reference-image pixels (`terrain.js`).

Output can be saved as PNG, GIF, or MP4/WebM video.

It is part of the ANKLE/aleqth ecosystem and is themed to match
`/ankle96` (silver Win95 chrome, Times serif, Courier mono, hard
shadows, no rounded corners, blue reserved for hyperlinks only — see
`https://aleqth.com/ankle96` for the canonical spec). Don't introduce
gradients/shadows/radii anywhere unless the user asks.

## Repo layout

```
/Users/alex/Desktop/ankle.control/
  index.html        ← shell + controls
  app.js            ← state machine, image loading, silhouette generator
  mosaic.js         ← 2D mode (not touched recently)
  terrain.js        ← 3D mode — most of the recent work is here
  style.css         ← ankle96 chrome (already detuned from blue)
  ankle_no_hand.png ← default asset (black foot silhouette + alpha)
  mona.jpg          ← default reference image
  README.md
```

Remote: `https://github.com/aleqth/ankle.control` → main → GitHub Pages.
Deploy = `git push origin main`. Pages rebuilds in ~30–60 s.

Three.js r128 (CDN) + gif.js 0.2.0 (CDN). MediaRecorder for video.

## What landed in the last 4 commits

1. `70a4e3d` — default tint = `reference`; hardened PNG/GIF/Video click
   handlers (try/catch, `setTimeout(remove,250)` so the click commits).
2. `7eaaccc` — record-as-is default; **9 motion modes** including
   `sentient`; intensity slider; killed the navy title strip + flattened
   the MOSAIC/TERRAIN tabs; tightened the control grid.
3. `05f8e44` — speed slider; transparent export; color picker always
   visible + auto-switches to Solid on pick; `?v=4` cache-bust on JS.

Resulting state: the default view should be a *colored* mosaic of the
reference image, gently breathing, ready for as-is GIF/Video capture.

## Open requests from the user that are NOT yet done

### 1. Color is still rendering black for the user even after v3 + v4

This is the most important open thread. **I verified by puppeteer +
direct file inspection that the deployed JS sets `tintMode='reference'`
by default and the silhouette canvas comes out white (255,255,255,255)**
— so the data flowing into the InstancedMesh is correct. Headless
WebGL couldn't initialize so I couldn't visually confirm the rendered
output.

User reports persist: "the default upload, it always goes and shows up
as black when it actually should show the actual color and gradients or
color scheme of the original image" + "I can't even like actually change
the the asset color when it's on solid solid color mode like when i go
to the color picker and change it, it doesn't show".

Suspected causes still to rule out (in priority order):

- **Stale browser cache.** v4 added `?v=4` to the script tags — first
  thing to do is have the user hard-refresh and confirm the page now
  loads `terrain.js?v=4`. If they see `?v=3` or no query, the old HTML
  is cached too and a Cmd+Shift+R is needed.
- **InstancedMesh + vertexColors path in Three.js r128.** Verify in a
  real browser that `mesh.instanceColor.needsUpdate = true` actually
  propagates to the GPU on rebuild. In r128, `MeshBasicMaterial` needs
  `vertexColors: true` for `instanceColor` to multiply into the
  fragment. That's set when not in 'original' mode (terrain.js:168).
- **Alpha test eating the colored tiles.** Material uses
  `alphaTest: 0.2` (terrain.js:166). If the silhouette mask comes out
  with low-alpha edges *everywhere* the asset would be invisible — but
  the center pixel is `a:255` so this is unlikely.
- **Order-of-operations on rebuild after switching tint.** The select's
  `change` handler calls `rebuild()` which calls `disposeMesh()` then
  re-creates the mesh. If `disposeMesh()` removed the old mesh from the
  scene but didn't null `mesh.instanceColor`, the new buffer wouldn't
  initialize. Check `disposeMesh()` in terrain.js:~95.

**The fastest debug path** is to puppeteer with a real Chromium binary
(not swiftshader) and dump the post-rebuild `mesh.instanceColor.array`
+ a `renderer.readRenderTargetPixels` sample. I didn't have a clean way
to do that headlessly in this session.

### 2. Layout should resemble `/motion`

User said: "the layout should actually more so resemble the forward
slash motion layout. but keep the canvas and like all the elements just
put just adjust the format and composition to resemble the forward
slash motion layout".

Reference: `https://aleqth.com/motion` (source:
`/var/www/portfolio/backend/motion.html` on aleqth-prod, ~3,000 lines).

That page has:
- Big square canvas on the left (~60% of viewport width)
- Right rail of stacked control sections, each in a thin `.ctrl-section`
  panel with an `<h3>` and tight padding
- Filters as small chip buttons in a grid
- Inventory pinned at the bottom of the right rail

Current `ankle.control` is grid-based with controls above the canvas.
The next agent should restructure `index.html` to mirror motion.html's
layout: canvas left, right rail of stacked panels. Don't import
motion.html's CSS verbatim — re-style with the existing `style.css`
tokens (`--bg`, `--chip`, `--warn`, etc.) to stay ankle96-consistent.

### 3. Per-asset / per-instance design control

User wants more design control over individual asset movement. Today
the only knob is global intensity + global speed. Concrete next moves:

- A "Motion mask" canvas where the user paints where motion happens —
  multiply per-instance amplitude by mask intensity.
- Per-row and per-column phase offsets (so the user can choreograph
  diagonal waves vs vertical ripples).
- Per-instance variance seed (jitter so each cell drifts in its own
  direction even on coherent modes).
- A "Look-at" mode that orients each instance toward an in-canvas point
  the user can drag.

## Useful trivia about the codebase

- **`AnkleControl` global** lives in `app.js`. State, events, image
  loaders. Mode modules (`mosaic.js`, `terrain.js`) subscribe via
  `AnkleControl.on('mode-enter'|'mode-leave'|'reference'|'asset'|...)`.
- **`state.assetSilhouetteCanvas`** is built by
  `preprocessAssetToSilhouette()` in app.js:54 — converts the asset PNG
  into a white-RGB + original-alpha canvas (or alpha-from-luminance for
  opaque PNGs). Required for `solid` + `reference` tint modes to work.
- **`renderExportFrame(t, startYaw)`** in terrain.js drives both GIF and
  Video capture. Honors `exportSpin` (off by default → records the
  current viewport) and multiplies the motion phase by both
  `exportDuration` and `motionSpeed`.
- **GIF worker** is fetched from cdnjs and re-served as a blob URL to
  dodge the CORS-on-workers gotcha (terrain.js:loadGifWorker).
- **Video codec ladder**: mp4 → webm/vp9 → webm/vp8 → webm. Transparent
  export forces webm/vp9 (only browser codec that carries alpha).

## Things the user has flagged as out-of-scope or solved

- **Blue tabs** ✅ — killed the navy title bar; flattened mode tabs.
- **PNG/GIF/Video downloads not firing** ✅ — fixed with try/catch +
  deferred anchor cleanup. If the user reports this again, it's almost
  certainly the cache (now busted with `?v=4`).
- **Background image works** — user confirmed; don't refactor.

## How to get back into this session

```bash
cd /Users/alex/Desktop/ankle.control
git log --oneline -8     # last commits, all by Claude Opus 4.7
git diff HEAD~3 -- terrain.js | less   # see the v3+v4 changes
```

Live site: https://aleqth.github.io/ankle.control/

The user's habit is to take screenshots of the live site and describe
the bug in their own terms — don't ask them to open DevTools, just
diagnose from the screenshot + read the source.

## Tone

The user prefers concise replies, no trailing summaries unless they ask.
They flag work that "should be a thing another agent can see, read, and
replicate" — keep the canonical artifacts honest (versioned tokens,
spec page, verifier). They moved fast across many surfaces tonight
(ankle.control, motion.html inventory wiring, ankle96 design system) —
expect mid-session jumps.
