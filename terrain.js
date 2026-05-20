// terrain.js — 3D asset-instance reconstruction of the reference image.
//
// Renders an InstancedMesh of textured planes (one per grid cell of the
// reference image). Each instance:
//   - Position XY = the cell's location in the reference image (centered)
//   - Position Z  = luminance of that cell × depth amplitude (pops bright
//                   areas forward; dark areas recede)
//   - Color       = the sampled RGB of that cell, tinting the (white-mask)
//                   asset texture
//   - Optional motion (wave / pulse / twist) applied in the render loop.
//
// Viewed head-on, the collection of asset silhouettes reads as the
// reference picture. Orbit to see the sculptural depth.

(function () {
  let renderer, scene, camera, mesh, material, geometry, assetTexture, bgTexture;
  let stage, raf = null, started = false;

  let depthAmplitude = 6;
  let density = 70;            // columns; rows derived from aspect ratio
  let cellOverlap = 1.4;       // tile scale relative to cell size — slight overlap for continuity
  let autoRotate = false;
  let motionMode = 'breathe';  // 'none' | 'wave' | 'pulse' | 'twist' | 'breathe' | 'cascade' | 'ripple' | 'walk' | 'flutter' | 'orbit' | 'sentient'
  let motionIntensity = 1.0;   // overall scaling for motion magnitude (0..2)
  let motionSpeed = 1.0;       // playback rate multiplier on the motion phase (0.1..4)
  let exportSpin = false;      // when true, GIF/Video adds a 360° Y rotation across the loop. Default OFF — record the live viewport.
  let exportTransparent = false; // when true, GIF/Video export uses a transparent background (alpha preserved through the renderer)
  let motionStartTime = performance.now();
  let tintMode = 'reference';  // 'original' | 'solid' | 'reference' — default 'reference' so the output is colored on first paint instead of inheriting the asset PNG's flat color.
  let tintColor = '#ff8c5a';   // color used when tintMode === 'solid'
  let scaleByLuminance = true; // make brighter pixels render larger so the image emerges
  let exportDuration = 3;      // seconds (loop length for GIF / video export)
  let exportFps = 30;          // frames per second for GIF / video
  let exportQuality = 10;      // gif.js quality (lower = better, larger file)
  let _gifWorkerUrl = null;    // cached blob URL of gif.worker.js (cross-origin workaround)

  // Per-instance state arrays, refreshed each rebuild.
  let baseZ = null;            // Float32Array of base Z per instance
  let baseColor = null;        // Uint8Array RGB×count (for stable color)
  let instanceCount = 0;
  let cellSize = 1;            // world units per cell
  let cols = 0, rows = 0;

  let drag = null;
  let yaw = 0, pitch = 0, distance = 70;

  function init() {
    if (started) return;
    stage = document.getElementById('terrain-stage');
    if (!stage) return;
    if (typeof THREE === 'undefined') {
      AnkleControl.setStatus('three.js failed to load');
      return;
    }

    const rect = stage.getBoundingClientRect();
    const W = Math.max(320, Math.floor(rect.width || 800));
    const H = Math.max(280, Math.floor(W * 0.66));

    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    stage.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    applyBackground();

    camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 1000);
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);

    rebuild();
    attachInteraction();
    started = true;
    loop();
  }

  function destroy() {
    if (!started) return;
    cancelAnimationFrame(raf);
    raf = null;
    detachInteraction();
    disposeMesh();
    if (assetTexture) { assetTexture.dispose(); assetTexture = null; }
    if (bgTexture) { bgTexture.dispose(); bgTexture = null; }
    if (renderer) {
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    }
    renderer = scene = camera = null;
    baseZ = null; baseColor = null; instanceCount = 0;
    started = false;
  }

  function disposeMesh() {
    if (mesh) { scene.remove(mesh); }
    if (geometry) { geometry.dispose(); geometry = null; }
    if (material) { material.dispose(); material = null; }
    mesh = null;
  }

  function applyBackground() {
    if (!scene) return;
    if (AnkleControl.state.backgroundImage) {
      const img = AnkleControl.state.backgroundImage;
      if (bgTexture) bgTexture.dispose();
      bgTexture = new THREE.Texture(img);
      bgTexture.needsUpdate = true;
      scene.background = bgTexture;
    } else {
      try {
        scene.background = new THREE.Color(AnkleControl.state.backgroundColor);
      } catch (e) {
        scene.background = new THREE.Color('#0a0a0e');
      }
    }
  }

  function rebuild() {
    const refImg = AnkleControl.state.referenceImage;
    const refCanvas = AnkleControl.state.referenceCanvas;
    const assetCanvas = AnkleControl.state.assetSilhouetteCanvas;
    if (!refImg || !refCanvas || !assetCanvas) return;

    disposeMesh();
    if (assetTexture) { assetTexture.dispose(); assetTexture = null; }

    // Sample reference image down to `density` columns × derived rows.
    const refW = refImg.naturalWidth, refH = refImg.naturalHeight;
    cols = Math.max(20, density);
    rows = Math.max(20, Math.round(cols * refH / refW));
    const sample = document.createElement('canvas');
    sample.width = cols; sample.height = rows;
    const sctx = sample.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(refCanvas, 0, 0, cols, rows);
    const data = sctx.getImageData(0, 0, cols, rows).data;

    // Compute world layout. Keep the reconstructed picture about 48 units
    // wide so the default camera (z=70) frames it nicely.
    const worldWidth = 48;
    cellSize = worldWidth / cols;
    const worldHeight = cellSize * rows;

    instanceCount = cols * rows;

    // Texture choice depends on tint mode:
    //   - 'original': use the asset PNG as-is, preserving its native color.
    //   - 'solid' or 'reference': use the white-silhouette mask so per-
    //     instance vertex colors actually tint the asset shape.
    const useOriginalTexture = (tintMode === 'original');
    const textureSource = useOriginalTexture
      ? AnkleControl.state.assetImage
      : assetCanvas;
    assetTexture = useOriginalTexture
      ? new THREE.Texture(textureSource)
      : new THREE.CanvasTexture(textureSource);
    assetTexture.minFilter = THREE.LinearFilter;
    assetTexture.magFilter = THREE.LinearFilter;
    assetTexture.needsUpdate = true;

    geometry = new THREE.PlaneGeometry(1, 1);
    material = new THREE.MeshBasicMaterial({
      map: assetTexture,
      transparent: true,
      alphaTest: 0.2,
      side: THREE.DoubleSide,
      vertexColors: !useOriginalTexture, // off in 'original' so PNG color is preserved
      depthWrite: true,
      depthTest: true,
    });

    mesh = new THREE.InstancedMesh(geometry, material, instanceCount);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (!mesh.instanceColor) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(instanceCount * 3), 3
      );
    }
    mesh.frustumCulled = false;

    baseZ = new Float32Array(instanceCount);
    baseColor = new Float32Array(instanceCount * 3);

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const solidColor = new THREE.Color(tintColor);

    const scaleBase = cellSize * cellOverlap;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const di = idx * 4;
        const rr = data[di], gg = data[di + 1], bb = data[di + 2];
        const lum = (0.299 * rr + 0.587 * gg + 0.114 * bb) / 255;

        const x = (c - (cols - 1) / 2) * cellSize;
        const y = -(r - (rows - 1) / 2) * cellSize;
        const z = lum * depthAmplitude;
        baseZ[idx] = z;

        // Per-instance size: when we're not tinting per-pixel, the image
        // would otherwise have no visual hierarchy head-on, so we modulate
        // scale by luminance (bright pixels render larger). In 'reference'
        // tint mode the per-pixel colour already carries that hierarchy,
        // so we keep scale uniform.
        let sc = scaleBase;
        if (scaleByLuminance && tintMode !== 'reference') {
          sc = scaleBase * (0.55 + lum * 0.85);
        }

        dummy.position.set(x, y, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(sc, sc, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);

        if (tintMode === 'reference') {
          color.setRGB(rr / 255, gg / 255, bb / 255);
          mesh.setColorAt(idx, color);
          baseColor[idx * 3] = rr / 255;
          baseColor[idx * 3 + 1] = gg / 255;
          baseColor[idx * 3 + 2] = bb / 255;
        } else if (tintMode === 'solid') {
          mesh.setColorAt(idx, solidColor);
          baseColor[idx * 3] = solidColor.r;
          baseColor[idx * 3 + 1] = solidColor.g;
          baseColor[idx * 3 + 2] = solidColor.b;
        }
        // 'original': no instanceColor — texture is used unmodified.
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor && tintMode !== 'original') {
      mesh.instanceColor.needsUpdate = true;
    }

    // Center mesh + apply current orientation
    mesh.rotation.set(pitch, yaw, 0);
    scene.add(mesh);

    AnkleControl.setStatus('terrain: ' + instanceCount + ' instances (' + cols + '×' + rows + ')');
  }

  function instanceBaseScale(lum) {
    const base = cellSize * cellOverlap;
    if (scaleByLuminance && tintMode !== 'reference') {
      return base * (0.55 + lum * 0.85);
    }
    return base;
  }

  function applyMotion(timeSec) {
    if (!mesh || motionMode === 'none') return;
    const dummy = new THREE.Object3D();
    const I = motionIntensity;
    // Center of the grid in cell coordinates — used by ripple / orbit modes.
    const cx = (cols - 1) / 2;
    const cy = (rows - 1) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const x = (c - cx) * cellSize;
        const y = -(r - cy) * cellSize;
        let z = baseZ[idx];
        let dx = 0, dy = 0, rotZ = 0;
        // Recover luminance from base z to keep scale modulation correct.
        const lum = depthAmplitude > 0 ? Math.min(1, z / depthAmplitude) : 0.5;
        let sc = instanceBaseScale(lum);

        if (motionMode === 'wave') {
          // Horizontal sine wave across columns — each row delayed.
          z += Math.sin(timeSec * 1.6 + c * 0.18 + r * 0.05) * 1.4 * I;

        } else if (motionMode === 'pulse') {
          // Uniform breathing scale modulation phased by position.
          sc *= (1 + Math.sin(timeSec * 2 + (r + c) * 0.07) * 0.18 * I);

        } else if (motionMode === 'twist') {
          // Each cell rocks around its own center — like a field of feet
          // turning back and forth, hence the "sentient" feel.
          rotZ = Math.sin(timeSec * 1.2 + idx * 0.013) * 0.5 * I;

        } else if (motionMode === 'breathe') {
          // Whole mosaic expands and contracts slightly — calm default.
          const s = 1 + Math.sin(timeSec * 1.1) * 0.06 * I;
          sc *= s;
          z += Math.sin(timeSec * 0.9) * 0.6 * I;

        } else if (motionMode === 'cascade') {
          // Diagonal sweep — feels like rain or a wave passing through.
          const phase = timeSec * 2 - (c + r) * 0.18;
          z += Math.sin(phase) * 1.6 * I;
          sc *= (1 + Math.sin(phase) * 0.08 * I);

        } else if (motionMode === 'ripple') {
          // Concentric rings from grid center — drop a stone in water.
          const dxC = c - cx, dyC = r - cy;
          const d = Math.sqrt(dxC * dxC + dyC * dyC);
          z += Math.sin(timeSec * 2.4 - d * 0.55) * 1.8 * I;

        } else if (motionMode === 'walk') {
          // Subtle vertical bob with horizontal sway — feet stepping.
          dy += Math.abs(Math.sin(timeSec * 2.6 + idx * 0.011)) * 1.0 * I;
          dx += Math.sin(timeSec * 2.6 + idx * 0.011) * 0.4 * I;
          rotZ = Math.sin(timeSec * 2.6 + idx * 0.011) * 0.08 * I;

        } else if (motionMode === 'flutter') {
          // High-frequency low-amplitude jitter on rotation + z.
          // Per-instance noise so it doesn't feel coherent.
          const n = Math.sin(idx * 0.91 + timeSec * 9) * 0.6
                  + Math.cos(idx * 0.37 + timeSec * 6) * 0.4;
          rotZ = n * 0.16 * I;
          z += n * 0.3 * I;

        } else if (motionMode === 'orbit') {
          // Each cell traces a small circle around its anchor.
          const phase = timeSec * 1.4 + idx * 0.05;
          dx += Math.cos(phase) * cellSize * 0.15 * I;
          dy += Math.sin(phase) * cellSize * 0.15 * I;
          rotZ = phase * 0.08;

        } else if (motionMode === 'sentient') {
          // Composite mode — feet/ankles that feel like they're aware:
          // gentle breath + per-cell rotation looking for the camera +
          // occasional twitch. This is the "the thinker" mode the user
          // described: the assets feel like a population, not a texture.
          const breath = Math.sin(timeSec * 0.7) * 0.04;
          sc *= (1 + breath * I);
          // Long, slow looking-around motion, offset by position so the
          // whole field doesn't move in unison.
          const lookT = timeSec * 0.4 + (c * 0.12 - r * 0.08);
          rotZ = Math.sin(lookT) * 0.28 * I;
          // Subtle drift toward the centroid then back out.
          const dxC = c - cx, dyC = r - cy;
          const d = Math.sqrt(dxC * dxC + dyC * dyC) + 0.001;
          const pull = Math.sin(timeSec * 0.55 + d * 0.2) * 0.18 * I;
          dx += (dxC / d) * pull * cellSize * 0.3;
          dy += (dyC / d) * pull * cellSize * 0.3;
          // Twitch: a sparse hard z-pop on a small fraction of cells.
          if ((Math.sin(timeSec * 1.7 + idx * 1.31) > 0.985)) {
            z += 2.2 * I;
          }
        }

        dummy.position.set(x + dx, y + dy, z);
        dummy.rotation.set(0, 0, rotZ);
        dummy.scale.set(sc, sc, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  function loop() {
    if (!started) return;
    raf = requestAnimationFrame(loop);
    if (autoRotate && mesh) { yaw += 0.003; mesh.rotation.y = yaw; }
    if (motionMode !== 'none') {
      const t = ((performance.now() - motionStartTime) / 1000) * motionSpeed;
      applyMotion(t);
    }
    if (renderer) renderer.render(scene, camera);
  }

  function onResize() {
    if (!started || !stage || !renderer) return;
    const rect = stage.getBoundingClientRect();
    const W = Math.max(320, Math.floor(rect.width || 800));
    const H = Math.max(280, Math.floor(W * 0.66));
    renderer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }

  function attachInteraction() {
    const cnv = renderer.domElement;
    cnv.addEventListener('mousedown', onDown);
    cnv.addEventListener('wheel', onWheel, { passive: false });
    cnv.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onUp);
    window.addEventListener('resize', onResize);
  }

  function detachInteraction() {
    if (renderer) {
      const cnv = renderer.domElement;
      cnv.removeEventListener('mousedown', onDown);
      cnv.removeEventListener('wheel', onWheel);
      cnv.removeEventListener('touchstart', onTouchStart);
    }
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onUp);
    window.removeEventListener('resize', onResize);
  }

  function onDown(e) {
    drag = { x: e.clientX, y: e.clientY };
    setAutoRotate(false);
  }
  function onTouchStart(e) {
    if (e.touches.length === 1) { drag = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }
  }
  function onMove(e) {
    if (!drag || !mesh) return;
    const dx = (e.clientX - drag.x) * 0.01;
    const dy = (e.clientY - drag.y) * 0.01;
    yaw += dx;
    pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch + dy));
    mesh.rotation.set(pitch, yaw, 0);
    drag.x = e.clientX; drag.y = e.clientY;
  }
  function onTouchMove(e) {
    if (!drag || !mesh || e.touches.length !== 1) return;
    e.preventDefault();
    const dx = (e.touches[0].clientX - drag.x) * 0.01;
    const dy = (e.touches[0].clientY - drag.y) * 0.01;
    yaw += dx;
    pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch + dy));
    mesh.rotation.set(pitch, yaw, 0);
    drag.x = e.touches[0].clientX; drag.y = e.touches[0].clientY;
  }
  function onUp() { drag = null; }
  function onWheel(e) {
    e.preventDefault();
    distance = Math.max(20, Math.min(220, distance + e.deltaY * 0.05));
    camera.position.z = distance;
  }

  function setAutoRotate(target) {
    autoRotate = target;
    const chk = document.getElementById('terrain-rotate');
    if (chk) chk.checked = target;
  }

  function savePng() {
    try {
      if (!renderer) {
        AnkleControl.setStatus('PNG export: renderer not ready — load an image first');
        return;
      }
      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ankle_terrain_' + Date.now() + '.png';
      // Some setups need rel=noopener to allow download; harmless when not needed.
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      // Defer cleanup so the browser has actually committed the click.
      setTimeout(() => { try { a.remove(); } catch(_){} }, 100);
      AnkleControl.setStatus('saved terrain PNG → check your Downloads folder');
    } catch (e) {
      console.error('[ankle.control] PNG export failed:', e);
      AnkleControl.setStatus('PNG export failed: ' + (e && e.message ? e.message : e));
    }
  }

  // Fetch gif.worker.js into a Blob URL so it can be used cross-origin.
  // Mirrors the pattern in aleqth.com/motion to avoid CORS on workers.
  function loadGifWorker() {
    if (_gifWorkerUrl) return Promise.resolve(_gifWorkerUrl);
    return fetch('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js')
      .then((r) => r.text())
      .then((txt) => {
        _gifWorkerUrl = URL.createObjectURL(new Blob([txt], { type: 'application/javascript' }));
        return _gifWorkerUrl;
      });
  }

  // Render a frame at progress t in [0,1) into the live renderer canvas.
  // By default the camera/mesh orientation is whatever the user has set in
  // the live viewport — we just animate the motion mode forward. Set
  // exportSpin=true to overlay a 360° Y rotation across the loop (the old
  // behavior — kept as an option, no longer the default).
  function renderExportFrame(t, startYaw) {
    if (!mesh) return;
    if (exportSpin) {
      yaw = startYaw + t * Math.PI * 2;
      mesh.rotation.set(pitch, yaw, 0);
    } else {
      // Keep the user's current orbit position frozen during export.
      mesh.rotation.set(pitch, startYaw, 0);
    }
    if (motionMode !== 'none') {
      // Loop the motion phase across the recording so the result tiles.
      // Motion speed multiplier respected so the exported clip moves at
      // the same rate the user previewed.
      const tSec = t * exportDuration * motionSpeed;
      applyMotion(tSec);
    }
    renderer.render(scene, camera);
  }

  async function exportGif() {
    if (!renderer) return;
    if (typeof window.GIF === 'undefined') {
      AnkleControl.setStatus('gif.js not loaded');
      return;
    }
    const btn = document.getElementById('terrain-gif');
    const vbtn = document.getElementById('terrain-video');
    const label = btn.textContent;
    btn.disabled = true; if (vbtn) vbtn.disabled = true;
    btn.textContent = 'GIF…';
    AnkleControl.setStatus('preparing gif worker…');
    try {
      await loadGifWorker();
    } catch (e) {
      AnkleControl.setStatus('gif worker fetch failed');
      btn.disabled = false; if (vbtn) vbtn.disabled = false;
      btn.textContent = label;
      return;
    }
    const cnv = renderer.domElement;
    const totalFrames = Math.max(2, Math.round(exportDuration * exportFps));
    const delayMs = Math.round(1000 / exportFps);
    // gif.js supports a transparent index. When the user wants a transparent
    // bg, drop the scene background so the canvas reveals page transparency.
    const savedBg = scene ? scene.background : null;
    if (exportTransparent && scene) scene.background = null;
    const gif = new window.GIF({
      workers: 4,
      quality: exportQuality,
      width: cnv.width,
      height: cnv.height,
      workerScript: _gifWorkerUrl,
      repeat: 0,
      transparent: exportTransparent ? 0x000000 : null,
    });

    const savedYaw = yaw;
    const savedAuto = autoRotate;
    autoRotate = false;

    for (let i = 0; i < totalFrames; i++) {
      const t = i / totalFrames;
      renderExportFrame(t, savedYaw);
      gif.addFrame(cnv, { copy: true, delay: delayMs });
      AnkleControl.setStatus('gif frame ' + (i + 1) + '/' + totalFrames);
      if (i % 6 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    // Restore background after frame capture so the live preview returns to normal.
    if (exportTransparent && scene) scene.background = savedBg;

    yaw = savedYaw; autoRotate = savedAuto;
    if (mesh) mesh.rotation.set(pitch, yaw, 0);

    gif.on('progress', (p) => {
      AnkleControl.setStatus('gif encoding ' + Math.round(p * 100) + '%');
    });
    gif.on('finished', (blob) => {
      try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ankle_terrain_' + Date.now() + '.gif';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { try { a.remove(); URL.revokeObjectURL(url); } catch(_){} }, 250);
        const kb = Math.round(blob.size / 1024);
        AnkleControl.setStatus('gif saved (' +
          (kb > 1024 ? (blob.size / 1048576).toFixed(1) + ' MB' : kb + ' KB') + ') → check your Downloads folder');
      } catch (e) {
        console.error('[ankle.control] GIF download failed:', e);
        AnkleControl.setStatus('GIF download failed: ' + (e && e.message ? e.message : e));
      } finally {
        btn.disabled = false; if (vbtn) vbtn.disabled = false;
        btn.textContent = label;
      }
    });
    gif.on('abort', () => {
      AnkleControl.setStatus('gif aborted');
      btn.disabled = false; if (vbtn) vbtn.disabled = false;
      btn.textContent = label;
    });
    gif.render();
  }

  async function exportVideo() {
    if (!renderer) return;
    if (typeof MediaRecorder === 'undefined') {
      AnkleControl.setStatus('MediaRecorder not supported');
      return;
    }
    const btn = document.getElementById('terrain-video');
    const gbtn = document.getElementById('terrain-gif');
    const label = btn.textContent;
    btn.disabled = true; if (gbtn) gbtn.disabled = true;
    btn.textContent = 'Video…';

    const cnv = renderer.domElement;
    // Codec fallback ladder — mp4 first (best compat), then WebM/VP9
    // (transparency-capable via yuva420p), then VP8, then generic webm.
    // Transparent export forces VP9-in-webm because mp4 won't carry alpha.
    let mimeType;
    if (exportTransparent) {
      mimeType = 'video/webm;codecs=vp9';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';
      }
    } else {
      mimeType = 'video/mp4';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp9';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/webm;codecs=vp8';
          if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';
        }
      }
    }
    const ext = mimeType.indexOf('mp4') !== -1 ? 'mp4' : 'webm';

    // Strip the scene background while recording so canvas alpha passes
    // through to the encoder. Restored when recording stops.
    const savedBgVideo = scene ? scene.background : null;
    if (exportTransparent && scene) scene.background = null;

    const stream = cnv.captureStream(exportFps);
    const chunks = [];
    let rec;
    try {
      rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12000000 });
    } catch (e) {
      AnkleControl.setStatus('video init failed: ' + e.message);
      btn.disabled = false; if (gbtn) gbtn.disabled = false;
      btn.textContent = label;
      return;
    }
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const done = new Promise((resolve) => {
      rec.onstop = () => {
        try {
          const blob = new Blob(chunks, { type: mimeType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'ankle_terrain_' + Date.now() + '.' + ext;
          a.rel = 'noopener';
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { try { a.remove(); URL.revokeObjectURL(url); } catch(_){} }, 250);
          const kb = Math.round(blob.size / 1024);
          AnkleControl.setStatus('video saved (' +
            (kb > 1024 ? (blob.size / 1048576).toFixed(1) + ' MB' : kb + ' KB') + ') .' + ext + ' → check your Downloads folder');
        } catch (e) {
          console.error('[ankle.control] video download failed:', e);
          AnkleControl.setStatus('video download failed: ' + (e && e.message ? e.message : e));
        } finally {
          btn.disabled = false; if (gbtn) gbtn.disabled = false;
          btn.textContent = label;
          resolve();
        }
      };
    });

    const savedYaw = yaw;
    const savedAuto = autoRotate;
    autoRotate = false;

    rec.start();
    AnkleControl.setStatus('recording ' + exportDuration + 's @ ' + exportFps + 'fps (' + ext + ')…');

    const startTs = performance.now();
    const durMs = exportDuration * 1000;
    const tick = () => {
      const elapsed = performance.now() - startTs;
      const t = elapsed / durMs;
      if (t >= 1) {
        // Render one last frame at t=1, then stop.
        renderExportFrame(0.999, savedYaw);
        rec.stop();
        yaw = savedYaw; autoRotate = savedAuto;
        if (mesh) mesh.rotation.set(pitch, yaw, 0);
        // Restore background after recording stops.
        if (exportTransparent && scene) scene.background = savedBgVideo;
        return;
      }
      renderExportFrame(t, savedYaw);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    await done;
  }

  function wireControls() {
    const dSlider = document.getElementById('terrain-density');
    const dVal = document.getElementById('terrain-density-val');
    if (dSlider) {
      const apply = () => {
        density = parseInt(dSlider.value, 10);
        if (dVal) dVal.textContent = String(density);
      };
      dSlider.addEventListener('input', apply);
      dSlider.addEventListener('change', () => { apply(); rebuild(); });
      apply();
    }
    const hSlider = document.getElementById('terrain-depth');
    const hVal = document.getElementById('terrain-depth-val');
    if (hSlider) {
      const apply = () => {
        depthAmplitude = parseFloat(hSlider.value);
        if (hVal) hVal.textContent = String(depthAmplitude);
      };
      hSlider.addEventListener('input', apply);
      hSlider.addEventListener('change', () => { apply(); rebuild(); });
      apply();
    }
    const motion = document.getElementById('terrain-motion');
    if (motion) {
      // Reflect the default into the select on first paint.
      motion.value = motionMode;
    }
    if (motion) motion.addEventListener('change', () => {
      motionMode = motion.value;
      motionStartTime = performance.now();
      if (motionMode === 'none' && mesh) {
        // Reset all matrices to base when stopping motion.
        const dummy = new THREE.Object3D();
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            const x = (c - (cols - 1) / 2) * cellSize;
            const y = -(r - (rows - 1) / 2) * cellSize;
            const lum = depthAmplitude > 0 ? Math.min(1, baseZ[idx] / depthAmplitude) : 0.5;
            dummy.position.set(x, y, baseZ[idx]);
            dummy.rotation.set(0, 0, 0);
            const sc = instanceBaseScale(lum);
            dummy.scale.set(sc, sc, 1);
            dummy.updateMatrix();
            mesh.setMatrixAt(idx, dummy.matrix);
          }
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
    });
    const tint = document.getElementById('terrain-tint');
    if (tint) {
      // Force the <select> to whatever the JS default is — protects against
      // stale browser-cached HTML where the selected option disagrees with
      // the script. Without this the dropdown could say "reference" while the
      // module booted with a different default (or vice versa).
      tint.value = tintMode;
    }
    if (tint) tint.addEventListener('change', () => {
      tintMode = tint.value;
      rebuild();
    });
    const tintC = document.getElementById('terrain-tint-color');
    if (tintC) tintC.addEventListener('input', () => {
      tintColor = tintC.value;
      // Picking a color implies the user wants Solid mode. If they're on
      // any other mode (reference/original), auto-switch to Solid so the
      // change is actually visible. Was previously a silent no-op which
      // looked like the picker was broken.
      if (tintMode !== 'solid') {
        tintMode = 'solid';
        if (tint) tint.value = 'solid';
      }
      rebuild();
    });
    const ar = document.getElementById('terrain-rotate');
    if (ar) ar.addEventListener('change', () => { autoRotate = ar.checked; });
    // Spin-during-export toggle — when off (default), the GIF/Video records
    // the viewport AS-IS; when on, overlays a 360° Y rotation across the loop.
    const spinChk = document.getElementById('terrain-export-spin');
    if (spinChk) {
      spinChk.checked = exportSpin;
      spinChk.addEventListener('change', () => { exportSpin = spinChk.checked; });
    }
    // Transparent-bg export toggle. Strips scene.background while encoding
    // and forces VP9-in-webm for video so alpha survives the codec.
    const transChk = document.getElementById('terrain-export-transparent');
    if (transChk) {
      transChk.checked = exportTransparent;
      transChk.addEventListener('change', () => { exportTransparent = transChk.checked; });
    }
    // Motion intensity — multiplies amplitude across all modes.
    const mi = document.getElementById('terrain-motion-intensity');
    const miVal = document.getElementById('terrain-motion-intensity-val');
    if (mi) {
      const apply = () => {
        motionIntensity = parseFloat(mi.value) || 0;
        if (miVal) miVal.textContent = motionIntensity.toFixed(2).replace(/\.?0+$/, '') + '×';
      };
      mi.addEventListener('input', apply);
      apply();
    }
    // Motion speed — playback-rate multiplier on the phase used by each mode.
    const ms = document.getElementById('terrain-motion-speed');
    const msVal = document.getElementById('terrain-motion-speed-val');
    if (ms) {
      const apply = () => {
        motionSpeed = parseFloat(ms.value) || 0.0001;
        if (msVal) msVal.textContent = motionSpeed.toFixed(2).replace(/\.?0+$/, '') + '×';
      };
      ms.addEventListener('input', apply);
      apply();
    }
    const save = document.getElementById('terrain-save');
    if (save) save.addEventListener('click', savePng);

    // Export settings
    const eDur = document.getElementById('export-duration');
    const eDurVal = document.getElementById('export-duration-val');
    if (eDur) {
      const apply = () => {
        exportDuration = parseFloat(eDur.value);
        if (eDurVal) eDurVal.textContent = exportDuration + 's';
      };
      eDur.addEventListener('input', apply);
      apply();
    }
    const eFps = document.getElementById('export-fps');
    if (eFps) eFps.addEventListener('change', () => {
      exportFps = parseInt(eFps.value, 10) || 30;
    });
    const eQual = document.getElementById('export-quality');
    const eQualVal = document.getElementById('export-quality-val');
    if (eQual) {
      const apply = () => {
        exportQuality = parseInt(eQual.value, 10) || 10;
        if (eQualVal) eQualVal.textContent = String(exportQuality);
      };
      eQual.addEventListener('input', apply);
      apply();
    }
    const gifBtn = document.getElementById('terrain-gif');
    if (gifBtn) gifBtn.addEventListener('click', exportGif);
    const vidBtn = document.getElementById('terrain-video');
    if (vidBtn) vidBtn.addEventListener('click', exportVideo);
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireControls();
    AnkleControl.on('mode-enter', () => {
      if (AnkleControl.state.activeMode === 'terrain') init();
    });
    AnkleControl.on('mode-leave', () => {
      if (AnkleControl.state.activeMode === 'terrain') destroy();
    });
    AnkleControl.on('reference', () => {
      if (started && AnkleControl.state.activeMode === 'terrain') rebuild();
    });
    AnkleControl.on('asset', () => {
      if (started && AnkleControl.state.activeMode === 'terrain') rebuild();
    });
    AnkleControl.on('background', () => {
      if (started) applyBackground();
    });
  });
})();
