// ====== Setup & Resize Canvas ======
const canvas = document.getElementById("myCanvas");
const ctx = canvas.getContext("2d", { alpha: false });

function fitCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = Math.max(200, Math.floor(rect.width));
  const h = Math.max(200, Math.floor(rect.height));
  canvas.width  = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width  = w + "px";
  canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
}
window.addEventListener("resize", fitCanvas);
fitCanvas();

// ====== Kamera & batas ======
const CAM_Z = 600;
const NEAR  = 8;
const NEAR_EPS = 1e-4;

// Dimensi meja/kaki
const W = 300, D = 180, H = 150, T = 10;

// ====== State ======
let rotX = 0;
let rotY = 0;
let rotZ = 0;
let pos  = { x: 0, y: 0, z: 0 }; // default di tengah & tegak

// ====== UI ======
const rotXEl = document.getElementById("rotX");
const rotYEl = document.getElementById("rotY");
const rotZEl = document.getElementById("rotZ");
const valRotX = document.getElementById("valRotX");
const valRotY = document.getElementById("valRotY");
const valRotZ = document.getElementById("valRotZ");
const posReadout = document.getElementById("posReadout");
const btn = {
  xMinus: document.getElementById("xMinus"), xPlus : document.getElementById("xPlus"),
  yMinus: document.getElementById("yMinus"), yPlus : document.getElementById("yPlus"),
  zMinus: document.getElementById("zMinus"), zPlus : document.getElementById("zPlus"),
};

// ====== 3D Math (Vec4) ======
class Vec4 { constructor(x=0, y=0, z=0, w=1){ this.x=x; this.y=y; this.z=z; this.w=w; } }

function rotatePoint(p, rx, ry, rz) {
  let {x, y, z} = p;
  const cx=Math.cos(rx), sx=Math.sin(rx),
        cy=Math.cos(ry), sy=Math.sin(ry),
        cz=Math.cos(rz), sz=Math.sin(rz);
  // X
  let ny=y*cx - z*sx, nz=y*sx + z*cx; y=ny; z=nz;
  // Y
  let nx=x*cy + z*sy; nz=-x*sy + z*cy; x=nx; z=nz;
  // Z
  nx=x*cz - y*sz; ny=x*sz + y*cz; x=nx; y=ny;
  return new Vec4(x, y, z);
}

function project(p) {
  const z_cam = p.z + CAM_Z;
  const s = CAM_Z / z_cam;
  return {
    x: p.x * s + canvas.clientWidth / 2,
    y: -p.y * s + canvas.clientHeight / 2,
    z: p.z,
    z_cam
  };
}

// ====== Face & Shape ======
class Face { constructor(vertices, color){ this.vertices = vertices; this.color = color; } }
class Shape { constructor(faces, sortBias=0){ this.faces = faces; this.sortBias = sortBias; } }

// ====== Geometry ======
function createBox(x1, x2, y1, y2, z1, z2, color, sortBias=0) {
  const v = [
    new Vec4(x1, y1, z1), new Vec4(x2, y1, z1), new Vec4(x2, y2, z1), new Vec4(x1, y2, z1),
    new Vec4(x1, y1, z2), new Vec4(x2, y1, z2), new Vec4(x2, y2, z2), new Vec4(x1, y2, z2)
  ];
  // CCW dari luar
  const faces = [
    new Face([v[4], v[5], v[6], v[7]], color), // +Z
    new Face([v[1], v[0], v[3], v[2]], color), // -Z
    new Face([v[7], v[6], v[2], v[3]], color), // +Y
    new Face([v[0], v[1], v[5], v[4]], color), // -Y
    new Face([v[1], v[5], v[6], v[2]], color), // +X
    new Face([v[0], v[3], v[7], v[4]], color)  // -X
  ];
  return new Shape(faces, sortBias);
}

const COL_LEG  = "#000000";
const COL_BACK = "#d2b48c";
const COL_TOP  = "#8b7355";

const legBias = 0.1, backBias = -0.1, topBias = 0.2;

const shapes = [
  createBox(-W/2, -W/2+T, -H, 0, -D/2, D/2-1, COL_LEG, legBias),
  createBox( W/2-T,  W/2, -H, 0, -D/2, D/2-1, COL_LEG, legBias),
  createBox(-W/2, W/2, 0, T, -D/2, D/2, COL_TOP, topBias)
];

// papan belakang 3/4
{
  const backHeight = H * 0.75;
  const GAP = 1.5;
  const x1 = -W/2 + T + GAP;
  const x2 =  W/2 - T - GAP;
  const y1 = -backHeight;
  const y2 =  0;
  const z1 = D/2 - T - 2;
  const z2 = D/2 - 2;
  shapes.push(createBox(x1, x2, y1, y2, z1, z2, COL_BACK, backBias));
}

// ====== Clipping Near-Plane ======
const zdist = p => p.z + CAM_Z;
const insideNear = p => zdist(p) >= (NEAR + NEAR_EPS);

function clipAgainstNear(verts) {
  if (verts.length < 3) return [];
  const out = [];
  for (let i = 0; i < verts.length; i++) {
    const A = verts[i];
    const B = verts[(i + 1) % verts.length];
    const Ain = insideNear(A);
    const Bin = insideNear(B);

    if (Ain && Bin) {
      out.push(new Vec4(B.x, B.y, B.z));
    } else if (Ain && !Bin) {
      const t = (NEAR - zdist(A)) / (zdist(B) - zdist(A));
      out.push(new Vec4(
        A.x + (B.x - A.x) * t,
        A.y + (B.y - A.y) * t,
        A.z + (B.z - A.z) * t
      ));
    } else if (!Ain && Bin) {
      const t = (NEAR - zdist(A)) / (zdist(B) - zdist(A));
      out.push(new Vec4(
        A.x + (B.x - A.x) * t,
        A.y + (B.y - A.y) * t,
        A.z + (B.z - A.z) * t
      ));
      out.push(new Vec4(B.x, B.y, B.z));
    }
  }
  return out.length >= 3 ? out : [];
}

// ====== Helpers ======
function faceNormal(a, b, c) {
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
  const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
  return { x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx };
}
function snap05(v){ return { x: Math.round(v.x) + 0.5, y: Math.round(v.y) + 0.5 }; }

function drawPolygon(points, color) {
  if (points.length < 3) return;
  ctx.beginPath();
  const p0 = snap05(points[0]);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < points.length; i++) {
    const pi = snap05(points[i]);
    ctx.lineTo(pi.x, pi.y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = color;
  ctx.stroke();
}

// ====== Rendering ======
function draw() {
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  const bucket = [];
  const EPS = 1e-6;
  const POLY_OFFSET = 2e-3;

  shapes.forEach(shape => {
    shape.faces.forEach(face => {
      const vv0 = face.vertices.map(v => {
        const r = rotatePoint(v, rotX, rotY, rotZ);
        return new Vec4(r.x + pos.x, r.y + pos.y, r.z + pos.z);
      });

      const vv = clipAgainstNear(vv0);
      if (vv.length < 3) return;

      const n = faceNormal(vv[0], vv[1], vv[2]);

      const pts = [];
      let maxZcam = -Infinity, avgZcam = 0, minZcam = Infinity;
      for (const v of vv) {
        const z_cam = v.z + CAM_Z;
        maxZcam = Math.max(maxZcam, z_cam);
        minZcam = Math.min(minZcam, z_cam);
        avgZcam += z_cam;
        const p2 = project(v);
        pts.push(p2);
      }
      avgZcam /= vv.length;

      const adaptive = (n.z < 0 ? -POLY_OFFSET : +POLY_OFFSET);

      bucket.push({
        points: pts,
        color: face.color,
        depth: maxZcam + shape.sortBias + adaptive + EPS * bucket.length,
        tie: minZcam + avgZcam * 0.1
      });
    });
  });

  bucket.sort((a, b) => b.depth - a.depth || b.tie - a.tie);
  for (const f of bucket) drawPolygon(f.points, f.color);

  requestAnimationFrame(draw);
}
draw();

// ====== Events ======
function setLabel(el, lab){ lab.textContent = `${el.value}°`; }
function deg2rad(deg){ return deg * Math.PI / 180; }

// sinkron dari UI (default 0°)
rotX = deg2rad(+rotXEl.value);
rotY = deg2rad(+rotYEl.value);
rotZ = deg2rad(+rotZEl.value);
setLabel(rotXEl, valRotX); setLabel(rotYEl, valRotY); setLabel(rotZEl, valRotZ);

rotXEl.oninput = () => { rotX = deg2rad(+rotXEl.value); setLabel(rotXEl, valRotX); };
rotYEl.oninput = () => { rotY = deg2rad(+rotYEl.value); setLabel(rotYEl, valRotY); };
rotZEl.oninput = () => { rotZ = deg2rad(+rotZEl.value); setLabel(rotZEl, valRotZ); };

const STEP = 20;
const STEP_Z = 10;

// Tombol – arah yang intuitif
btn.xMinus.onclick = () => { pos.x -= STEP; showPos(); };
btn.xPlus.onclick  = () => { pos.x += STEP; showPos(); };
btn.yMinus.onclick = () => { pos.y -= STEP; showPos(); }; // Y− turun
btn.yPlus.onclick  = () => { pos.y += STEP; showPos(); }; // Y+ naik
btn.zMinus.onclick = () => { pos.z += STEP_Z; showPos(); }; // Z− menjauh
btn.zPlus.onclick  = () => { pos.z -= STEP_Z; showPos(); }; // Z+ mendekat

function showPos(){ posReadout.textContent = `Posisi: x=${pos.x}, y=${pos.y}, z=${pos.z}`; }
showPos();

// Keyboard: WASD + panah + Q/E untuk Z
window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
  if (tag === 'input' || tag === 'textarea') return; // jangan ganggu slider
  let moved = false;
  switch (e.key) {
    case 'ArrowLeft': case 'a': case 'A': pos.x -= STEP; moved = true; break;
    case 'ArrowRight': case 'd': case 'D': pos.x += STEP; moved = true; break;
    case 'ArrowUp': case 'w': case 'W': pos.y += STEP; moved = true; break;
    case 'ArrowDown': case 's': case 'S': pos.y -= STEP; moved = true; break;
    case 'q': case 'Q': pos.z -= STEP_Z; moved = true; break; // mendekat
    case 'e': case 'E': pos.z += STEP_Z; moved = true; break; // menjauh
  }
  if (moved) { e.preventDefault(); showPos(); }
});
