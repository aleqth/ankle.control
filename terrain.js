// terrain.js — three.js heightmap driven by the reference image.
//
// The plane's vertex Z is set per-grid-cell from the luminance of the
// reference image (luminance formula 0.299R + 0.587G + 0.114B). The
// reference image itself is mapped as the texture so the picture is
// visible on the surface.
//
// Controls:
//   height slider  — Z amplitude multiplier
//   grid slider    — geometry resolution (more = sharper, slower)
//   wireframe      — show the underlying mesh
//   auto-rotate    — slow yaw
//   texture mode   — color (the image) / grayscale / depth-shading
//   drag           — orbit / rotate the mesh
//   wheel          — zoom

(function () {
  let renderer, scene, camera, mesh, material, geometry, texture;
  let stage, raf = null, started = false;
  let amplitude = 18;
  let gridResolution = 120;
  let autoRotate = true;
  let wireframe = false;
  let textureMode = 'color'; // 'color' | 'grayscale' | 'depth'
  let drag = null;
  let yaw = -0.15, pitch = 0.55, distance = 95;
  let rotationVelocity = 0.003;

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
    const H = Math.max(240, Math.floor(W * 0.66));

    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 1);
    stage.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 1000);
    camera.position.set(0, 40, distance);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(40, 80, 50);
    scene.add(dir);
    const fill = new THREE.DirectionalLight(0x8888ff, 0.25);
    fill.position.set(-40, 20, -30);
    scene.add(fill);

    rebuildMesh();
    attachMouse();
    started = true;
    loop();
  }

  function destroy() {
    if (!started) return;
    cancelAnimationFrame(raf);
    raf = null;
    detachMouse();
    if (mesh) { scene.remove(mesh); }
    if (geometry) geometry.dispose();
    if (material) material.dispose();
    if (texture) texture.dispose();
    if (renderer) {
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    }
    renderer = scene = camera = mesh = material = geometry = texture = null;
    started = false;
  }

  function refresh() {
    if (!started) return;
    rebuildMesh();
  }

  function rebuildMesh() {
    const refImg = AnkleControl.state.referenceImage;
    if (!refImg) return;

    if (mesh) {
      scene.remove(mesh);
      if (geometry) geometry.dispose();
      if (material) material.dispose();
      if (texture) texture.dispose();
    }

    const refW = refImg.naturalWidth, refH = refImg.naturalHeight;
    const ar = refW / refH;
    const planeW = 80;
    const planeH = planeW / ar;

    const segX = gridResolution;
    const segY = Math.max(20, Math.round(gridResolution / ar));
    geometry = new THREE.PlaneGeometry(planeW, planeH, segX - 1, segY - 1);

    // Sample image luminance into per-vertex z.
    const refCanvas = AnkleControl.state.referenceCanvas;
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = segX;
    sampleCanvas.height = segY;
    const sctx = sampleCanvas.getContext('2d');
    sctx.drawImage(refImg, 0, 0, segX, segY);
    const data = sctx.getImageData(0, 0, segX, segY).data;

    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      // Vertices are laid out row-major from top-left. PlaneGeometry uses
      // (segX) columns × (segY) rows of vertices.
      const col = i % segX;
      const row = Math.floor(i / segX);
      // Image rows count from top → flip Y because plane's Y+ is up.
      const sx = col;
      const sy = row;
      const idx = (sx + sy * segX) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255; // 0..1
      pos.setZ(i, lum * amplitude);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();

    // Build texture per mode.
    if (textureMode === 'color') {
      texture = new THREE.Texture(refImg);
      texture.needsUpdate = true;
      material = new THREE.MeshPhongMaterial({
        map: texture, side: THREE.DoubleSide, wireframe,
        shininess: 18, flatShading: false,
      });
    } else if (textureMode === 'grayscale') {
      const gc = document.createElement('canvas');
      gc.width = refW; gc.height = refH;
      const gctx = gc.getContext('2d');
      gctx.filter = 'grayscale(100%) contrast(115%)';
      gctx.drawImage(refImg, 0, 0);
      texture = new THREE.CanvasTexture(gc);
      material = new THREE.MeshPhongMaterial({
        map: texture, side: THREE.DoubleSide, wireframe,
        shininess: 8, flatShading: false,
      });
    } else { // depth
      material = new THREE.MeshPhongMaterial({
        color: 0xc8c8d4, side: THREE.DoubleSide, wireframe,
        shininess: 28, flatShading: true,
      });
    }

    mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2 + pitch;
    mesh.rotation.z = yaw;
    scene.add(mesh);
  }

  function loop() {
    if (!started) return;
    raf = requestAnimationFrame(loop);
    if (autoRotate && mesh) {
      yaw += rotationVelocity;
      mesh.rotation.z = yaw;
    }
    if (renderer) renderer.render(scene, camera);
  }

  function onResize() {
    if (!started || !stage || !renderer) return;
    const rect = stage.getBoundingClientRect();
    const W = Math.max(320, Math.floor(rect.width || 800));
    const H = Math.max(240, Math.floor(W * 0.66));
    renderer.setSize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
  }

  function attachMouse() {
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

  function detachMouse() {
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

  function onDown(e) { drag = { x: e.clientX, y: e.clientY }; autoRotate = syncAutoRotate(false); }
  function onTouchStart(e) {
    if (e.touches.length === 1) { drag = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }
  }
  function onMove(e) {
    if (!drag || !mesh) return;
    const dx = (e.clientX - drag.x) * 0.01;
    const dy = (e.clientY - drag.y) * 0.01;
    yaw += dx;
    pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch - dy));
    mesh.rotation.x = -Math.PI / 2 + pitch;
    mesh.rotation.z = yaw;
    drag.x = e.clientX; drag.y = e.clientY;
  }
  function onTouchMove(e) {
    if (!drag || !mesh || e.touches.length !== 1) return;
    e.preventDefault();
    const dx = (e.touches[0].clientX - drag.x) * 0.01;
    const dy = (e.touches[0].clientY - drag.y) * 0.01;
    yaw += dx;
    pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch - dy));
    mesh.rotation.x = -Math.PI / 2 + pitch;
    mesh.rotation.z = yaw;
    drag.x = e.touches[0].clientX; drag.y = e.touches[0].clientY;
  }
  function onUp() { drag = null; }
  function onWheel(e) {
    e.preventDefault();
    distance = Math.max(30, Math.min(250, distance + e.deltaY * 0.08));
    camera.position.z = distance;
  }

  function syncAutoRotate(target) {
    const chk = document.getElementById('terrain-rotate');
    if (chk) chk.checked = target;
    return target;
  }

  function savePng() {
    if (!renderer) return;
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ankle_terrain_' + Date.now() + '.png';
    document.body.appendChild(a); a.click(); a.remove();
    AnkleControl.setStatus('saved terrain PNG');
  }

  function wireControls() {
    const hSlider = document.getElementById('terrain-height');
    const hVal = document.getElementById('terrain-height-val');
    if (hSlider) {
      hSlider.addEventListener('input', () => {
        amplitude = parseFloat(hSlider.value);
        if (hVal) hVal.textContent = String(amplitude);
        rebuildMesh();
      });
      amplitude = parseFloat(hSlider.value);
      if (hVal) hVal.textContent = String(amplitude);
    }
    const gSlider = document.getElementById('terrain-grid');
    const gVal = document.getElementById('terrain-grid-val');
    if (gSlider) {
      gSlider.addEventListener('input', () => {
        gridResolution = parseInt(gSlider.value, 10);
        if (gVal) gVal.textContent = String(gridResolution);
      });
      gSlider.addEventListener('change', () => {
        gridResolution = parseInt(gSlider.value, 10);
        rebuildMesh();
      });
      gridResolution = parseInt(gSlider.value, 10);
      if (gVal) gVal.textContent = String(gridResolution);
    }
    const wf = document.getElementById('terrain-wire');
    if (wf) wf.addEventListener('change', () => {
      wireframe = wf.checked;
      if (material) material.wireframe = wireframe;
    });
    const ar = document.getElementById('terrain-rotate');
    if (ar) ar.addEventListener('change', () => { autoRotate = ar.checked; });
    const tex = document.getElementById('terrain-tex');
    if (tex) tex.addEventListener('change', () => {
      textureMode = tex.value;
      rebuildMesh();
    });
    const save = document.getElementById('terrain-save');
    if (save) save.addEventListener('click', savePng);
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
      if (AnkleControl.state.activeMode === 'terrain') refresh();
    });
  });
})();
