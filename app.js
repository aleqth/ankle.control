// app.js — shared state for ankle.control
//
// Single source of truth for:
//   - REFERENCE image: the picture being recreated (mona, upload, etc.)
//   - ASSET image:     the tile/instance shape used as the brush stroke
//                      (default ankle silhouette, user-replaceable)
//   - BACKGROUND image: optional background for TERRAIN mode
//
// Renderers (mosaic.js, terrain.js) register on() callbacks for the
// events 'reference', 'asset', 'background', 'mode-enter', 'mode-leave'.

(function () {
  const REFERENCE_PRESETS = [
    { path: 'mona.jpg',          label: 'Mona Lisa (default)' },
    { path: 'ankle_no_hand.png', label: 'Ankle (self-portrait)' },
  ];

  const state = {
    referenceUrl: REFERENCE_PRESETS[0].path,
    referenceImage: null,
    referenceCanvas: null,
    assetImage: null,
    assetSilhouetteCanvas: null,  // white-mask version of asset for tinted instancing
    backgroundImage: null,        // optional HTMLImageElement for terrain bg
    backgroundColor: '#7a7a82',   // medium gray — contrasts both light + dark refs
    listeners: [],
    activeMode: 'mosaic',
    status: 'init',
  };

  function loadImageElement(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('failed to load: ' + url));
      img.src = url;
    });
  }

  function buildCanvasFromImage(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return c;
  }

  // Build a white-RGB-with-original-alpha version of the asset, so it can
  // act as a tintable silhouette when used as a texture. If the source
  // image is opaque (no real alpha), fall back to treating darker pixels
  // as more opaque (so a black-on-white silhouette also works).
  function preprocessAssetToSilhouette(img) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const work = document.createElement('canvas');
    work.width = w; work.height = h;
    const wctx = work.getContext('2d', { willReadFrequently: true });
    wctx.drawImage(img, 0, 0);
    const src = wctx.getImageData(0, 0, w, h);

    // Detect whether the image has meaningful alpha. Sample 16 points;
    // if any have alpha < 200, treat as alpha-masked.
    let hasAlpha = false;
    for (let i = 0; i < 16; i++) {
      const x = Math.floor(Math.random() * w);
      const y = Math.floor(Math.random() * h);
      const a = src.data[(x + y * w) * 4 + 3];
      if (a < 200) { hasAlpha = true; break; }
    }
    // Always also check the corners since random sampling can miss small
    // transparent borders.
    const cornerIdx = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + (w - 1)) * 4];
    for (const ci of cornerIdx) {
      if (src.data[ci + 3] < 200) { hasAlpha = true; break; }
    }

    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const octx = out.getContext('2d');
    const dst = octx.createImageData(w, h);
    if (hasAlpha) {
      for (let i = 0; i < src.data.length; i += 4) {
        dst.data[i] = 255; dst.data[i + 1] = 255; dst.data[i + 2] = 255;
        dst.data[i + 3] = src.data[i + 3];
      }
    } else {
      for (let i = 0; i < src.data.length; i += 4) {
        const r = src.data[i], g = src.data[i + 1], b = src.data[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        dst.data[i] = 255; dst.data[i + 1] = 255; dst.data[i + 2] = 255;
        dst.data[i + 3] = 255 - Math.round(lum);
      }
    }
    octx.putImageData(dst, 0, 0);
    return out;
  }

  async function setReference(url, displayLabel) {
    setStatus('loading reference: ' + (displayLabel || url));
    try {
      const img = await loadImageElement(url);
      state.referenceUrl = url;
      state.referenceImage = img;
      state.referenceCanvas = buildCanvasFromImage(img);
      setStatus('reference ' + img.naturalWidth + '×' + img.naturalHeight);
      fire('reference');
    } catch (err) {
      setStatus('reference error: ' + err.message);
      console.error(err);
    }
  }

  async function setAsset(url, displayLabel) {
    setStatus('loading asset: ' + (displayLabel || url));
    try {
      const img = await loadImageElement(url);
      state.assetImage = img;
      state.assetSilhouetteCanvas = preprocessAssetToSilhouette(img);
      setStatus('asset ' + img.naturalWidth + '×' + img.naturalHeight);
      fire('asset');
    } catch (err) {
      setStatus('asset error: ' + err.message);
      console.error(err);
    }
  }

  async function setBackgroundImage(url, displayLabel) {
    if (!url) {
      state.backgroundImage = null;
      setStatus('background: color');
      fire('background');
      return;
    }
    setStatus('loading bg: ' + (displayLabel || url));
    try {
      const img = await loadImageElement(url);
      state.backgroundImage = img;
      setStatus('background image ' + img.naturalWidth + '×' + img.naturalHeight);
      fire('background');
    } catch (err) {
      setStatus('bg error: ' + err.message);
      console.error(err);
    }
  }

  function setBackgroundColor(color) {
    state.backgroundColor = color;
    state.backgroundImage = null; // color and image are mutually exclusive
    fire('background');
  }

  function setStatus(msg) {
    state.status = msg;
    const el = document.getElementById('status-msg');
    if (el) el.textContent = msg;
  }

  function fire(eventName) {
    for (const { name, fn } of state.listeners) {
      if (name === eventName) {
        try { fn(state); } catch (e) { console.error(e); }
      }
    }
  }

  function on(name, fn) { state.listeners.push({ name, fn }); }

  function applyModeUI(mode) {
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.mode === mode);
    });
    document.querySelectorAll('[data-mode-panel]').forEach((p) => {
      p.style.display = p.dataset.modePanel === mode ? '' : 'none';
    });
    document.querySelectorAll('[data-mode-stage]').forEach((s) => {
      s.style.display = s.dataset.modeStage === mode ? '' : 'none';
    });
  }

  function switchMode(mode) {
    if (mode === state.activeMode) return;
    fire('mode-leave');
    state.activeMode = mode;
    applyModeUI(mode);
    setStatus('mode: ' + mode);
    fire('mode-enter');
  }

  function wireControls() {
    // Tabs
    document.querySelectorAll('.tab').forEach((t) => {
      t.addEventListener('click', () => switchMode(t.dataset.mode));
    });

    // REFERENCE preset picker
    const refSel = document.getElementById('ref-preset');
    if (refSel) {
      REFERENCE_PRESETS.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.path;
        opt.textContent = p.label;
        refSel.appendChild(opt);
      });
      refSel.value = REFERENCE_PRESETS[0].path;
      refSel.addEventListener('change', () => {
        const p = REFERENCE_PRESETS.find((x) => x.path === refSel.value);
        setReference(refSel.value, p ? p.label : refSel.value);
      });
    }

    // REFERENCE upload
    const refUpload = document.getElementById('upload');
    if (refUpload) {
      refUpload.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        setReference(url, file.name);
        if (refSel) refSel.value = '';
      });
    }

    // ASSET upload + reset
    const assetUpload = document.getElementById('asset-upload');
    if (assetUpload) {
      assetUpload.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        setAsset(url, file.name);
      });
    }
    const assetReset = document.getElementById('asset-reset');
    if (assetReset) {
      assetReset.addEventListener('click', () => {
        setAsset('ankle_no_hand.png', 'ankle (default)');
        if (assetUpload) assetUpload.value = '';
      });
    }

    // BACKGROUND color
    const bgColor = document.getElementById('bg-color');
    if (bgColor) {
      bgColor.value = state.backgroundColor;
      bgColor.addEventListener('input', () => setBackgroundColor(bgColor.value));
    }
    const bgPreset = document.getElementById('bg-preset');
    if (bgPreset) {
      bgPreset.addEventListener('change', () => {
        const v = bgPreset.value;
        if (v === 'image') return; // image is handled by upload
        setBackgroundColor(v);
        if (bgColor) bgColor.value = v;
      });
    }

    // BACKGROUND image upload + clear
    const bgUpload = document.getElementById('bg-upload');
    if (bgUpload) {
      bgUpload.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        setBackgroundImage(URL.createObjectURL(file), file.name);
      });
    }
    const bgClear = document.getElementById('bg-clear');
    if (bgClear) {
      bgClear.addEventListener('click', () => {
        setBackgroundImage(null);
        if (bgUpload) bgUpload.value = '';
      });
    }

    // Clock in status bar
    const clock = document.getElementById('status-clock');
    if (clock) {
      const tick = () => {
        const d = new Date();
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        clock.textContent = hh + ':' + mm + ':' + ss;
      };
      tick();
      setInterval(tick, 1000);
    }
  }

  async function boot() {
    // Honor #mosaic / #terrain in the URL for deep-link / test access.
    const hashMode = (location.hash || '').replace('#', '').trim();
    if (hashMode === 'terrain' || hashMode === 'mosaic') {
      state.activeMode = hashMode;
      applyModeUI(hashMode);
    }
    wireControls();
    // Preload the default asset (the ankle silhouette).
    try {
      await setAsset('ankle_no_hand.png', 'ankle (default)');
    } catch (e) {
      setStatus('warning: missing ankle_no_hand.png');
    }
    // Preload default reference.
    await setReference(REFERENCE_PRESETS[0].path, REFERENCE_PRESETS[0].label);
    // Initialize the renderer for the currently active mode.
    fire('mode-enter');
  }

  window.AnkleControl = {
    state,
    on,
    setReference,
    setAsset,
    setBackgroundImage,
    setBackgroundColor,
    switchMode,
    setStatus,
    REFERENCE_PRESETS,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
