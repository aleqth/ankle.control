# ankle.control

Image-driven render module for the ANKLE OS. Pick a reference image (or
upload one) and switch between two renderings of it:

- **MOSAIC** — tile the image with ankle silhouettes whose size + rotation
  track per-tile brightness and contrast.
- **TERRAIN** — `three.js` heightmap whose vertex Z is set from per-pixel
  luminance. The reference image is mapped as the surface texture.
  Drag to orbit, wheel to zoom.

Both modes share the same source. Uploading a new image updates both.

## Run

It's a static site — open `index.html` in any browser, or:

```
python3 -m http.server 8765
# → http://localhost:8765/
```

Hosted at:

- `https://aleqth.github.io/ankle.control/` (this repo)
- `https://ankle.website/control` (mirror)

## Files

| file | what |
|------|------|
| `index.html` | shell, ankle96 chrome, tab switcher |
| `style.css` | self-contained ankle96 theme (no external CSS deps) |
| `app.js` | shared reference-image state + tab switching |
| `mosaic.js` | p5.js instance-mode mosaic renderer |
| `terrain.js` | three.js heightmap renderer |
| `ankle_no_hand.png` | the silhouette tiled by MOSAIC |
| `mona.jpg` | default reference image |

## v2 fixes over v1

- Source image is never mutated (v1 destroyed `referenceImg` on every
  slider tweak via in-place `.resize()`).
- Tile size floored to 6 (v1 allowed 1px tiles → browser lock).
- `windowResized` hooked up.
- Hi-res PNG export at the reference image's native resolution.
- Added TERRAIN mode (Three.js heightmap, mouse-drag orbit, wireframe +
  texture-mode toggles).
- ankle96 theme: Win95 chrome, Netscape gray, Times serif headings,
  Courier mono labels. No more candy-green button.

## License

MIT.
