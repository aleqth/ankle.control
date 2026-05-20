// mosaic.js — p5.js instance-mode mosaic renderer.
// Tiles the reference image with copies of the ASSET image (default:
// ankle silhouette) whose size + rotation track per-tile brightness and
// contrast.
//
// Fixes from v1:
//   - Source image is never mutated. Each draw clones with .get() and
//     resizes the clone only.
//   - tileSize floor raised from 1 to 6.
//   - windowResized hooked up.
//   - Hi-res export renders to an off-screen p5.Graphics at the reference
//     image's native resolution.
//   - Uses shared AnkleControl.state.assetImage (so a user-uploaded
//     asset works here too, not just in TERRAIN mode).

(function () {
  let p5Instance = null;
  let tileSize = 40;
  let p;

  function sketch(_p) {
    p = _p;

    _p.setup = function () {
      const stage = document.getElementById('mosaic-stage');
      const rect = stage.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width || 800));
      const ref = AnkleControl.state.referenceImage;
      const ar = ref ? (ref.naturalWidth / ref.naturalHeight) : (3 / 4);
      const cnv = _p.createCanvas(w, Math.floor(w / ar));
      cnv.parent(stage);
      _p.imageMode(_p.CENTER);
      _p.noLoop();
      requestRedraw();
    };

    _p.draw = function () {
      _p.background(255);
      const refImg = AnkleControl.state.referenceImage;
      const asset = AnkleControl.state.assetImage;
      if (!refImg || !asset) return;

      const work = _p.createImage(_p.width, _p.height);
      work.drawingContext.drawImage(refImg, 0, 0, _p.width, _p.height);
      work.loadPixels();

      const tileP5 = _p.createImage(asset.naturalWidth, asset.naturalHeight);
      tileP5.drawingContext.drawImage(asset, 0, 0);

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

  function exportHiRes() {
    const ref = AnkleControl.state.referenceImage;
    const asset = AnkleControl.state.assetImage;
    if (!ref || !asset || !p) {
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
      const tileP5 = p.createImage(asset.naturalWidth, asset.naturalHeight);
      tileP5.drawingContext.drawImage(asset, 0, 0);
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
    const stage = document.getElementById('mosaic-stage');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const newW = Math.max(320, Math.floor(rect.width || 800));
    const ref = AnkleControl.state.referenceImage;
    const ar = ref ? (ref.naturalWidth / ref.naturalHeight) : (3 / 4);
    p.resizeCanvas(newW, Math.floor(newW / ar));
    requestRedraw();
  }

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
    AnkleControl.on('asset', () => {
      if (AnkleControl.state.activeMode === 'mosaic') requestRedraw();
    });
  });
})();
