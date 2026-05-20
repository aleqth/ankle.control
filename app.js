// app.js — shared state + tab switching for ankle.control
//
// Provides a single source of truth for the reference image used by both
// the MOSAIC (p5.js) and TERRAIN (three.js) renderers. Renderers register
// callbacks via AnkleControl.onReferenceChange(fn) and re-render when fired.

(function () {
  const PRESETS = [
    { name: 'mona',        path: 'mona.jpg',         label: 'Mona Lisa (default)' },
    { name: 'ankle',       path: 'ankle_no_hand.png', label: 'Ankle (self-portrait)' },
  ];

  const state = {
    referenceUrl: PRESETS[0].path,
    referenceImage: null,        // HTMLImageElement once loaded
    referenceCanvas: null,       // OffscreenCanvas-style copy at native res
    tileImage: null,             // HTMLImageElement of ankle_no_hand.png
    listeners: [],
    activeMode: 'mosaic',
    status: 'init',
  };

  function loadImageElement(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error('failed to load: ' + url));
      img.src = url;
    });
  }

  function buildReferenceCanvas(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return c;
  }

  async function setReference(url, displayLabel) {
    setStatus('loading: ' + (displayLabel || url));
    try {
      const img = await loadImageElement(url);
      state.referenceUrl = url;
      state.referenceImage = img;
      state.referenceCanvas = buildReferenceCanvas(img);
      setStatus('loaded ' + img.naturalWidth + '×' + img.naturalHeight);
      fire('reference');
    } catch (err) {
      setStatus('error: ' + err.message);
      console.error(err);
    }
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

  function switchMode(mode) {
    if (mode === state.activeMode) return;
    fire('mode-leave');
    state.activeMode = mode;

    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.mode === mode);
    });
    document.querySelectorAll('[data-mode-panel]').forEach((p) => {
      p.style.display = p.dataset.modePanel === mode ? '' : 'none';
    });
    document.querySelectorAll('[data-mode-stage]').forEach((s) => {
      s.style.display = s.dataset.modeStage === mode ? '' : 'none';
    });

    setStatus('mode: ' + mode);
    fire('mode-enter');
  }

  function wireControls() {
    // Tabs
    document.querySelectorAll('.tab').forEach((t) => {
      t.addEventListener('click', () => switchMode(t.dataset.mode));
    });

    // Preset picker
    const sel = document.getElementById('ref-preset');
    if (sel) {
      PRESETS.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.path;
        opt.textContent = p.label;
        sel.appendChild(opt);
      });
      sel.value = PRESETS[0].path;
      sel.addEventListener('change', () => {
        const p = PRESETS.find((x) => x.path === sel.value);
        setReference(sel.value, p ? p.label : sel.value);
      });
    }

    // File upload
    const upload = document.getElementById('upload');
    if (upload) {
      upload.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        setReference(url, file.name);
        if (sel) sel.value = '';
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
      document.querySelectorAll('.tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.mode === hashMode);
      });
      document.querySelectorAll('[data-mode-panel]').forEach((p) => {
        p.style.display = p.dataset.modePanel === hashMode ? '' : 'none';
      });
      document.querySelectorAll('[data-mode-stage]').forEach((s) => {
        s.style.display = s.dataset.modeStage === hashMode ? '' : 'none';
      });
    }
    wireControls();
    // Preload the tile (ankle silhouette) used by mosaic mode.
    try {
      state.tileImage = await loadImageElement('ankle_no_hand.png');
    } catch (e) {
      setStatus('warning: missing ankle_no_hand.png');
    }
    // Load default reference. This fires 'reference' which both renderers
    // listen to.
    await setReference(PRESETS[0].path, PRESETS[0].label);
    // Initialize mode-specific renderer for the default tab.
    fire('mode-enter');
  }

  window.AnkleControl = {
    state,
    on,
    setReference,
    switchMode,
    setStatus,
    PRESETS,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
