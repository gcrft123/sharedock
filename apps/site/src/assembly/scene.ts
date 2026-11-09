/* The assembly scene.
 *
 * Every device is drawn as hard edges only: `EdgesGeometry` keeps an edge where the
 * angle between its two adjoining faces exceeds a threshold, and always keeps boundary
 * edges. The result distinguishes the planes of an object without ever drawing the
 * object, which is the sketch-outline read the brief asks for. It is also why the
 * models must not carry bevels: a chamfer turns one 90 degree edge into two ~45 degree
 * edges, and both clear the threshold, so a beveled corner draws as a doubled line.
 *
 * The sequence, driven entirely by scroll position:
 *   laptop -> tower -> server        rotating, crossfading
 *   -> the edges dissolve into points and go straight to the finished mark
 *   -> the points settle on its contour and resolve into crisp outlines
 *
 * The mark is built from the real artwork with SVGLoader and then reduced to its
 * outline, so the logo resolves in the same line language the devices are drawn in
 * rather than swapping to a filled shape at the end. Nothing here is drawn by hand.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { MARK_SVG, MARK_VIEWBOX } from "./markSvg";

const ORANGE = 0xff5a1f;

/** Hard-edge threshold. 32-segment cylinders facet at 11.25 degrees, so this keeps a
 *  fan's rim circles while leaving its barrel silent. Tuned per-model if needed. */
const EDGE_THRESHOLD = 24;

const MODELS = ["laptop", "tower", "server"] as const;

/** Resting yaw the assembly enters on. Opens the laptop on a 45-degree three-quarter
 *  turned toward the viewer's left, rather than head-on. Folded into `spin`, so the
 *  mark still squares up to the camera at the end (its settle rounds to the nearest
 *  whole turn, and this offset just shifts that origin). */
const INITIAL_YAW = (-3 * Math.PI) / 4;

/** Points in the drifting cloud field. Enough to read as a solid silhouette, few
 *  enough to stay comfortable on integrated graphics. */
const CLOUD_POINTS = 5200;

/** Progress is measured across the hero and the assembly together, so the first fifth
 *  is the hero: the laptop sits off to the right of the headline and drifts to centre
 *  as the assembly pins. The device beats are then even and the transformation
 *  accelerates into the mark. */
const INTRO_END = 0.2;
/** The devices dissolve and reassemble as the mark in one continuous move. There is no
 *  intermediate cloud-only state: the point field leaves the last device and goes
 *  straight to the finished logo. */
const S = { dev1: 0.36, dev2: 0.51, disperse: 0.62, dock: 0.86 };

/** Where the object sits during the hero, in world units to the right of centre, and
 *  the visual radius every device is normalised to. */
const INTRO_OFFSET_X = 1.32;
const DEVICE_RADIUS = 1.18;

/** Half-width of the finished mark in world units. The whole logo, cloud and cube
 *  alike, is built straight from the artwork, so nothing about it is derived or
 *  approximated: it lands on the real mark because it *is* the real mark. */
const MARK_SCALE = 1.0;

export type AssemblyHandle = {
  setProgress(p: number): void;
  setActive(on: boolean): void;
  resize(): void;
  dispose(): void;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Hermite smoothstep. Ease in and out, no overshoot, no bounce. */
function smooth(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/* ---- brand mark ----------------------------------------------------------------- */

/** Build the mark and reduce it to its outline.
 *
 *  markSvg.ts holds a flattened copy of the artwork: two filled shapes, no strokes. The
 *  cube's strokes were expanded and unioned offline, and the cube subtracted from the
 *  cloud, so what arrives here is already free of self-overlap and already layered.
 *  Only the fill branch exists because there is nothing left to stroke.
 *
 *  `EdgesGeometry` then turns each surface into its boundary. Every piece is flat, so
 *  adjoining triangles share a normal and every interior edge is discarded; only edges
 *  with a single adjoining face survive, which is precisely the contour. The cloud
 *  therefore draws as two concentric contours rather than one centreline, because what
 *  is being outlined is the thick form itself, not the path that generated it.
 *
 *  Same technique the devices are drawn with, so the sequence resolves in one language
 *  rather than swapping to a filled logo at the end. */
function buildMarkGeometry(): THREE.BufferGeometry[] {
  const fills: THREE.BufferGeometry[] = [];
  for (const path of new SVGLoader().parse(MARK_SVG).paths) {
    for (const shape of SVGLoader.createShapes(path)) fills.push(new THREE.ShapeGeometry(shape));
  }

  // SVG space is y-down and 0..viewBox; world space is y-up and centred on the origin.
  const k = (2 * MARK_SCALE) / MARK_VIEWBOX;
  const m = new THREE.Matrix4().makeScale(k, -k, 1).setPosition(-MARK_SCALE, MARK_SCALE, 0);
  return fills.map((geo) => {
    geo.applyMatrix4(m);
    const outline = new THREE.EdgesGeometry(geo, 1);
    geo.dispose();
    return outline;
  });
}

/* ---- geometry helpers ----------------------------------------------------------- */

/** Centre a geometry on its bounding box and scale it to a consistent visual radius,
 *  so a 300mm tower and a 270mm laptop read at the same size on screen. */
function normalise(geo: THREE.BufferGeometry, radius = 1) {
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const c = new THREE.Vector3();
  box.getCenter(c);
  geo.translate(-c.x, -c.y, -c.z);
  geo.computeBoundingSphere();
  const r = geo.boundingSphere?.radius || 1;
  geo.scale(radius / r, radius / r, radius / r);
  return geo;
}

/** Bake a per-vertex alpha that falls off with distance from the object's centre, so
 *  the outline is fully inked through the middle and dissolves at its extremities.
 *
 *  This is what keeps the object from reading as a complete wireframe model: the lines
 *  never quite close, so the form is implied rather than drawn. Doing it per vertex
 *  rather than as a mask over the canvas means the fade rotates with the object instead
 *  of sitting still in front of it. */
function bakeEdgeAlpha(geo: THREE.BufferGeometry, inner = 0.55, outer = 1.5) {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 4);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = clamp01((v.length() - inner) / (outer - inner));
    col[i * 4] = 1;
    col[i * 4 + 1] = 1;
    col[i * 4 + 2] = 1;
    col[i * 4 + 3] = 1 - t * t * (3 - 2 * t) * 0.88;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 4));
  return geo;
}

/** Distribute `count` points evenly along a LineSegments geometry, so a device can
 *  dissolve into a point field that still traces its own edges. */
function pointsAlongEdges(edges: THREE.BufferGeometry, count: number): Float32Array {
  const pos = edges.getAttribute("position") as THREE.BufferAttribute;
  const segs = pos.count / 2;
  const out = new Float32Array(count * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const s = (Math.random() * segs) | 0;
    a.fromBufferAttribute(pos, s * 2);
    b.fromBufferAttribute(pos, s * 2 + 1);
    const t = Math.random();
    out[i * 3] = a.x + (b.x - a.x) * t;
    out[i * 3 + 1] = a.y + (b.y - a.y) * t;
    out[i * 3 + 2] = a.z + (b.z - a.z) * t;
  }
  return out;
}

/* ---- scene ---------------------------------------------------------------------- */

/** Takes a host element and creates its own canvas inside it.
 *
 *  Owning the canvas matters: teardown calls `forceContextLoss()`, which permanently
 *  kills the element it runs on. Borrowing a React-managed <canvas> meant StrictMode's
 *  mount/unmount/remount handed the second scene an already-dead node that could never
 *  get a context again. A canvas this function creates and removes cannot be reused by
 *  accident. */
export async function createAssembly(
  host: HTMLElement,
  opts: { reducedMotion: boolean; onStage?: (i: number) => void },
): Promise<AssemblyHandle> {
  const canvas = document.createElement("canvas");
  canvas.className = "narr-canvas";
  host.appendChild(canvas);
  // Context creation can fail on the requested attributes alone, so ask for the good
  // one and fall back rather than losing the whole section to a hint. `high-performance`
  // asks for the discrete GPU and is refused outright on some machines and in some
  // embedded views; antialias is likewise optional. Neither is worth a blank canvas,
  // and the audience for this product is exactly the hardware that says no.
  let created: THREE.WebGLRenderer | null = null;
  for (const attrs of [
    { antialias: true, alpha: true, powerPreference: "high-performance" as const },
    { antialias: true, alpha: true },
    { antialias: false, alpha: true },
  ]) {
    try {
      created = new THREE.WebGLRenderer({ canvas, ...attrs });
      break;
    } catch {
      created = null;
    }
  }
  if (!created) throw new Error("WebGL context unavailable");
  const renderer = created;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0, 5.2);

  const root = new THREE.Group();
  scene.add(root);

  /* devices ---------------------------------------------------------------------- */

  // Without this, React's StrictMode double-mount and every HMR update refetch all
  // three models.
  THREE.Cache.enabled = true;
  const loader = new GLTFLoader();
  const devices: { lines: THREE.LineSegments; mat: THREE.LineBasicMaterial; seed: Float32Array }[] = [];

  await Promise.all(
    MODELS.map(async (name, i) => {
      const gltf = await loader.loadAsync(`./models/${name}.glb`);
      const geos: THREE.BufferGeometry[] = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.geometry) return;
        const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
        // Strip everything but position: merging needs matching attribute sets, and
        // EdgesGeometry derives its angles from face geometry, not shading normals.
        for (const key of Object.keys(g.attributes)) if (key !== "position") g.deleteAttribute(key);
        geos.push(g.index ? g.toNonIndexed() : g);
      });
      if (!geos.length) return;

      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)!;
      normalise(merged, DEVICE_RADIUS);
      const edges = bakeEdgeAlpha(new THREE.EdgesGeometry(merged, EDGE_THRESHOLD));
      merged.dispose();
      geos.forEach((g) => g !== merged && g.dispose());

      const mat = new THREE.LineBasicMaterial({
        color: ORANGE,
        transparent: true,
        opacity: 0,
        vertexColors: true,
      });
      const lines = new THREE.LineSegments(edges, mat);
      lines.visible = false;
      root.add(lines);
      devices[i] = { lines, mat, seed: pointsAlongEdges(edges, CLOUD_POINTS) };
    }),
  );

  /* the mark ---------------------------------------------------------------------- */

  const markGeos = buildMarkGeometry();
  const markMat = new THREE.LineBasicMaterial({ color: ORANGE, transparent: true, opacity: 0 });
  const markGroup = new THREE.Group();
  markGroup.visible = false;
  for (const geo of markGeos) markGroup.add(new THREE.LineSegments(geo, markMat));
  root.add(markGroup);

  /* the point field ---------------------------------------------------------------- */

  // One target, not two. The points leave the last device and go straight to the
  // finished logo, and they settle on its contour rather than filling its area, so the
  // grain resolves into the same lines the mark is drawn with.
  const markTarget = pointsAlongEdges(mergeGeometries(markGeos, false)!, CLOUD_POINTS);

  const ptGeo = new THREE.BufferGeometry();
  const ptPos = new Float32Array(CLOUD_POINTS * 3);
  ptGeo.setAttribute("position", new THREE.BufferAttribute(ptPos, 3));
  const ptMat = new THREE.PointsMaterial({
    color: ORANGE,
    size: 0.016,
    transparent: true,
    opacity: 0,
    sizeAttenuation: true,
    depthWrite: false,
  });
  const points = new THREE.Points(ptGeo, ptMat);
  points.visible = false;
  root.add(points);

  // Per-point drift, so the cloud breathes instead of sitting still.
  const drift = new Float32Array(CLOUD_POINTS * 3);
  for (let i = 0; i < drift.length; i++) drift[i] = Math.random() * Math.PI * 2;

  /* driving ------------------------------------------------------------------------ */

  let progress = 0;
  let active = true;
  let raf = 0;
  let t0 = 0;
  let lastStage = -1;
  let narrow = false;
  let introOffset = INTRO_OFFSET_X;
  const tmp = new THREE.Vector3();

  function resize() {
    const r = host.getBoundingClientRect();
    const w = Math.max(1, r.width);
    const h = Math.max(1, r.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Matches the hero's stacking breakpoint in site.css. Below it the copy runs full
    // width, so there is nowhere beside the headline for the object to sit.
    narrow = w < 1080;
    camera.position.z = narrow ? 7.2 : 5.2;
    camera.updateProjectionMatrix();

    // Clamp the hero offset to what actually fits. A wide-but-short viewport has less
    // horizontal room in world units than the numbers suggest, and an object parked
    // past the frustum edge crops instead of bleeding.
    const halfW = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z * camera.aspect;
    introOffset = Math.max(0, Math.min(INTRO_OFFSET_X, halfW - DEVICE_RADIUS - 0.1));
  }

  function frame(t: number) {
    raf = requestAnimationFrame(frame);
    if (!active) return;
    if (!t0) t0 = t;

    const p = progress;
    const time = t * 0.001;

    // Two and a bit turns across the section, plus a slow idle so a paused scroll is
    // never a frozen image.
    const spin = INITIAL_YAW + p * Math.PI * 4.4 + (opts.reducedMotion ? 0 : time * 0.12);

    // The cloud and the mark are flat forms, so they have to square up to the viewer or
    // they foreshorten into mush. Easing toward the nearest whole turn settles the
    // rotation without ever appearing to rewind.
    const settle = smooth(S.disperse, S.dock, p);
    const whole = Math.round(spin / (Math.PI * 2)) * Math.PI * 2;
    root.rotation.y = spin + (whole - spin) * settle;
    root.rotation.x = Math.sin(p * Math.PI) * 0.16 * (1 - settle);

    // The hero: parked to the right of the headline, drifting to centre as the
    // assembly takes over.
    const intro = smooth(0, INTRO_END, p);
    root.position.x = narrow ? 0 : introOffset * (1 - intro);
    root.position.y = 0;

    // On a narrow viewport the hero copy runs full width, so there is nowhere for the
    // object to sit that is not behind the headline. It waits for the assembly to pin
    // instead, and the mobile hero is pure type.
    const introGate = narrow ? smooth(INTRO_END * 0.5, INTRO_END * 0.95, p) : 1;

    // A short fade on first paint, keyed to time rather than scroll: the object has to
    // be present in the hero at scroll position zero, so it cannot fade in on progress.
    const born = smooth(0, 900, t - t0);

    // Device crossfades, centred on the stage boundary and deliberately short: a wide
    // window leaves two wireframes overlapping for most of the beat, which reads as a
    // rendering fault rather than a transition.
    const X = 0.025;
    const swap1 = smooth(S.dev1 - X, S.dev1 + X, p);
    const swap2 = smooth(S.dev2 - X, S.dev2 + X, p);
    const devOpacity = [
      1 - swap1,
      swap1 * (1 - swap2),
      swap2 * (1 - smooth(S.disperse, S.disperse + 0.06, p)),
    ];
    for (let i = 0; i < devices.length; i++) {
      const d = devices[i];
      if (!d) continue;
      const o = clamp01(devOpacity[i] ?? 0) * born * introGate;
      d.mat.opacity = o * 0.92;
      d.lines.visible = o > 0.002;
    }

    // Dissolve straight into the mark. One buffer, one target, no waypoint.
    const toMark = smooth(S.disperse, S.dock + 0.04, p);
    const ptOn = smooth(S.disperse - 0.02, S.disperse + 0.08, p) * (1 - smooth(S.dock + 0.02, 0.99, p));

    ptMat.opacity = clamp01(ptOn) * 0.85;
    points.visible = ptMat.opacity > 0.004;

    if (points.visible) {
      // The device the points came from, so the dissolve traces its real edges.
      const src = devices[2]?.seed ?? devices[0]?.seed;
      // The drift is what makes the transit read as a cloud of loose parts rather than
      // a rigid tween, and it settles to nothing as the mark comes together.
      const wob = opts.reducedMotion ? 0 : 0.05 * Math.sin(Math.PI * toMark);
      for (let i = 0; i < CLOUD_POINTS; i++) {
        const k = i * 3;
        const sx = src ? src[k] : 0;
        const sy = src ? src[k + 1] : 0;
        const sz = src ? src[k + 2] : 0;
        tmp.set(
          sx + (markTarget[k] - sx) * toMark,
          sy + (markTarget[k + 1] - sy) * toMark,
          sz + (markTarget[k + 2] - sz) * toMark,
        );
        ptPos[k] = tmp.x + Math.sin(time * 0.9 + drift[k]) * wob;
        ptPos[k + 1] = tmp.y + Math.cos(time * 0.8 + drift[k + 1]) * wob;
        ptPos[k + 2] = tmp.z + Math.sin(time * 0.7 + drift[k + 2]) * wob;
      }
      (ptGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    }

    // The mark resolves from grain to crisp line in the final beat.
    const crisp = smooth(S.dock, 0.97, p);
    markMat.opacity = crisp;
    markGroup.visible = crisp > 0.004;

    const stage = p < S.dev1 ? 0 : p < S.dev2 ? 1 : p < S.disperse ? 2 : p < S.dock ? 3 : 4;
    if (stage !== lastStage) {
      lastStage = stage;
      opts.onStage?.(stage);
    }

    renderer.render(scene, camera);
  }

  resize();
  raf = requestAnimationFrame(frame);

  return {
    setProgress(p) {
      progress = clamp01(p);
    },
    setActive(on) {
      active = on;
    },
    resize,
    dispose() {
      cancelAnimationFrame(raf);
      scene.traverse((o) => {
        const any = o as THREE.Mesh;
        if (any.geometry) any.geometry.dispose();
        const m = (any as unknown as { material?: THREE.Material | THREE.Material[] }).material;
        if (Array.isArray(m)) m.forEach((x) => x.dispose());
        else m?.dispose();
      });
      // `dispose()` frees three's own GPU objects but leaves the WebGL context alive.
      // Browsers cap contexts (~16) and silently drop the oldest once past it, so
      // without this every StrictMode double-mount and every hot reload leaks one until
      // the canvas stops drawing entirely.
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
