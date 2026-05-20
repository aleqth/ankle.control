// mosaic.js — p5.js instance-mode mosaic renderer.
// Tiles the reference image with ankle silhouettes whose size + rotation
// track per-tile brightness and contrast.
//
// Fixes from v1:
//   - Source image is never mutated. Each draw clones with .get() and
//     resizes the clone only. Original survives slider tweaks + window
//     resizes intact.
//   - tileSize floor raised from 1 to 6 to prevent browser lock on
//     very small tiles.
//   - windowResized hooked up.
//   - Hi-res export renders to an off-screen p5.Graphics at the reference
//     image's native resolution.

(function () {
  let p5Instance = null;
  let tileSize = 40;
  let p; // p5 instance reference for control handlers
  let lastRefSig = null;

  function sketch(_p) {
    p = _p;
    let stageWidth = 800;

    _p.preload = function () {};

    _p.setup = function () {
      const stage = document.getElementById('mosaic-stage');
      const rect = stage.getBoundingClientRect();
      stageWidth = Math.max(320, Math.floor(rect.width || 800));
      const ref = AnkleControl.state.referenceImage;
      const ar = ref ? (ref.naturalWidth / ref.naturalHeight) : (3 / 4);
      const cnv = _p.createCanvas(stageWidth, Math.floor(stageWidth / ar));
      cnv.parent(stage);
      _p.imageMode(_p.CENTER);
      _p.noLoop();
      requestRedraw();
    };

    _p.draw = function () {
      _p.background(255);
      const refImg = AnkleControl.state.referenceImage;
      const tile = AnkleControl.state.tileImage;
      if (!refImg || !tile) return;

      // Work from a fresh p5.Image cloned from the source HTMLImageElement
      // so the original is never mutated. We size the work copy to the
      // canvas dimensions so pixel iteration matches what's rendered.
      const work = _p.createImage(_p.width, _p.height);
      work.drawingContext.drawImage(refImg, 0, 0, _p.width, _p.height);
      work.loadPixels();

      // Wrap the tile in a p5.Image so p5's image() can scale it.
      const tileP5 = _p.createImage(tile.naturalWidth, tile.naturalHeight);
      tileP5.drawingContext.drawImage(tile, 0, 0);

      paintMosaic(_p, work, tileP5, tileSize);
    };

    _p.windowResized = function () {
      const stage = document.getElementById('mosaic-stage');
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const newW = Math.max(320, Math.floor(rect.width || 800));
      const ref = AnkleControl.state.referenceImage;
      const ar = ref ? (ref.naturalWidth / ref.naturalHeight) : (3 / 4);
      _p.resizeCanvas(newW, Math.floor(newW / ar));
      stageWidth = newW;
      requestRedraw();
    };
  }

  function paintMosaic(p, work, tile, ts) {
    const pix = work.pixels;
    const w = work.width, h = work.height;
    const smooth = p.map(ts, 6, 80, 1.5, 0.5);

    const brightnessAt = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return 0;
      const i = (x + y * w) * 4;
      return (pix[i] + pix[i + 1] + pix[i + 2]) / 3;
    };

    for (let y = 0; y < h; y += ts) {
      for (let x = 0; x < w; x += ts) {
        const b = brightnessAt(x, y);
        let size = p.map(b, 0, 255, ts * smooth * 1.2, ts * smooth * 0.6);
        const contrast = Math.abs(b - brightnessAt(x + ts, y)) +
                         Math.abs(b - brightnessAt(x, y + ts));
        const cf = p.map(contrast, 0, 255, 1.0, 0.7);
        size *= cf;
        const angle = p.map(b, 0, 255, -Math.PI / 8, Math.PI / 8);
        const ox = (Math.random() - 0.5) * ts * 0.1;
        const oy = (Math.random() - 0.5) * ts * 0.1;
        p.push();
        p.translate(x + ox + ts / 2, y + oy + ts / 2);
        p.rotate(angle);
        p.image(tile, 0, 0, size, size);
        p.pop();
      }
    }
  }

  function requestRedraw() {
    if (p && typeof p.redraw === 'function') p.redraw();
  }

  // Hi-res export: re-render the mosaic at native source resolution into
  // an off-screen p5.Graphics, then save that out as a PNG. The visible
  // canvas is untouched.
  function exportHiRes() {
    const ref = AnkleControl.state.referenceImage;
    const tile = AnkleControl.state.tileImage;
    if (!ref || !tile || !p) {
      AnkleControl.setStatus('hi-res export unavailable: assets missing');
      return;
    }
    AnkleControl.setStatus('rendering hi-res…');
    setTimeout(() => {
      const w = ref.naturalWidth, h = ref.naturalHeight;
      const g = p.createGraphics(w, h);
      g.imageMode(p.CENTER);
      g.background(255);
      const work = p.createImage(w, h);
      work.drawingContext.drawImage(ref, 0, 0, w, h);
      work.loadPixels();
      const tileP5 = p.createImage(tile.naturalWidth, tile.naturalHeight);
      tileP5.drawingContext.drawImage(tile, 0, 0);
      // Scale tile size proportional to current canvas tileSize.
      const scale = w / p.width;
      const ts = Math.max(6, Math.round(tileSize * scale));
      paintMosaic(g, work, tileP5, ts);
      g.save('ankle_mosaic_' + w + 'x' + h + '.png');
      g.remove();
      AnkleControl.setStatus('saved ' + w + '×' + h + ' PNG');
    }, 30);
  }

  function start() {
    if (p5Instance) return;
    p5Instance = new p5(sketch);
  }

  function stop() {
    if (p5Instance) { p5Instance.remove(); p5Instance = null; p = null; }
  }

  function refresh() {
    if (!p5Instance) return;
    // Resize canvas to current reference aspect ratio, then redraw.
    const stage = document.getElementById('mosaic-stage');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const newW = Math.max(320, Math.floor(rect.width || 800));
    const ref = AnkleControl.state.referenceImage;
    const ar = ref ? (ref.naturalWidth / ref.naturalHeight) : (3 / 4);
    p.resizeCanvas(newW, Math.floor(newW / ar));
    requestRedraw();
  }

  // Wire controls (slider + save buttons)
  function wireControls() {
    const slider = document.getElementById('mosaic-tile');
    const readout = document.getElementById('mosaic-tile-val');
    if (slider) {
      slider.addEventListener('input', () => {
        tileSize = Math.max(6, parseInt(slider.value, 10) || 40);
        if (readout) readout.textContent = String(tileSize);
        requestRedraw();
      });
      tileSize = Math.max(6, parseInt(slider.value, 10) || 40);
      if (readout) readout.textContent = String(tileSize);
    }
    const saveBtn = document.getElementById('mosaic-save');
    if (saveBtn) saveBtn.addEventListener('click', () => {
      if (p) p.saveCanvas('ankle_mosaic', 'png');
    });
    const saveHiBtn = document.getElementById('mosaic-save-hires');
    if (saveHiBtn) saveHiBtn.addEventListener('click', exportHiRes);
  }

  // Hook into AnkleControl events
  document.addEventListener('DOMContentLoaded', () => {
    wireControls();

    AnkleControl.on('mode-enter', () => {
      if (AnkleControl.state.activeMode === 'mosaic') start();
    });
    AnkleControl.on('mode-leave', () => {
      if (AnkleControl.state.activeMode === 'mosaic') stop();
    });
    AnkleControl.on('reference', () => {
      if (AnkleControl.state.activeMode === 'mosaic') refresh();
    });
  });
})();
