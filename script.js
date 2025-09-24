const canvas = document.getElementById("myCanvas");
const gl = canvas.getContext("webgl", { antialias: true });
if (!gl) {
  alert("WebGL tidak tersedia di browser ini.");
}

function fitCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = Math.max(200, Math.floor(rect.width));
  const h = Math.max(200, Math.floor(rect.height));
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener("resize", fitCanvas);
fitCanvas();

const CAM_Z = 600;
const NEAR = 8;
const FAR = 2000;

const W = 300, D = 180, H = 150, T = 10;

let rotX = 0, rotY = 0, rotZ = 0;
let pos = { x: 0, y: 0, z: 0 };
let autoRotate = false;
const SPD = { x: 20, y: 30, z: 0 };
let lastTime = performance.now();

const rotXEl = document.getElementById("rotX");
const rotYEl = document.getElementById("rotY");
const rotZEl = document.getElementById("rotZ");
const valRotX = document.getElementById("valRotX");
const valRotY = document.getElementById("valRotY");
const valRotZ = document.getElementById("valRotZ");
const toggleAutoBtn = document.getElementById("toggleAuto");
const posReadout = document.getElementById("posReadout");
const btn = {
  xMinus: document.getElementById("xMinus"), xPlus: document.getElementById("xPlus"),
  yMinus: document.getElementById("yMinus"), yPlus: document.getElementById("yPlus"),
  zMinus: document.getElementById("zMinus"), zPlus: document.getElementById("zPlus"),
};

function compileShader(src, type) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function createProgram(vsSrc, fsSrc) {
  const vs = compileShader(vsSrc, gl.VERTEX_SHADER);
  const fs = compileShader(fsSrc, gl.FRAGMENT_SHADER);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(p));
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

function hexToRgbNorm(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const Mat4 = {
  identity() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
  multiply(a, b) {
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
        out[i * 4 + j] = s;
      }
    }
    return out;
  },
  translate(tx, ty, tz) {
    const m = Mat4.identity();
    m[12] = tx; m[13] = ty; m[14] = tz;
    return m;
  },
  rotateX(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
  },
  rotateY(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  },
  rotateZ(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  },
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = (2 * far * near) * nf;
    return out;
  }
};

const vsSource = `
attribute vec3 aPosition;
attribute vec3 aColor;
uniform mat4 uMVP;
varying vec3 vColor;
void main() {
  gl_Position = uMVP * vec4(aPosition, 1.0);
  vColor = aColor;
}
`;
const fsSource = `
precision mediump float;
varying vec3 vColor;
void main(){
  gl_FragColor = vec4(vColor, 1.0);
}
`;
const program = createProgram(vsSource, fsSource);
gl.useProgram(program);

const aPositionLoc = gl.getAttribLocation(program, "aPosition");
const aColorLoc = gl.getAttribLocation(program, "aColor");
const uMVPLoc = gl.getUniformLocation(program, "uMVP");

function createBoxData(x1, x2, y1, y2, z1, z2, color) {
  const px = [
    [x1, y1, z1], [x2, y1, z1], [x2, y2, z1], [x1, y2, z1],
    [x1, y1, z2], [x2, y1, z2], [x2, y2, z2], [x1, y2, z2]
  ];
  const facesQuads = [
    [0, 1, 2, 3], [4, 5, 6, 7], [3, 2, 6, 7], [0, 4, 5, 1],
    [1, 5, 6, 2], [0, 3, 7, 4]
  ];
  const pos = [], col = [];
  const rgb = hexToRgbNorm(color);
  for (let f = 0; f < facesQuads.length; f++) {
    const quad = facesQuads[f];
    const a = px[quad[0]], b = px[quad[1]], c = px[quad[2]], d = px[quad[3]];
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    pos.push(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    for (let k = 0; k < 6; k++) col.push(rgb[0], rgb[1], rgb[2]);
  }
  return { pos: new Float32Array(pos), col: new Float32Array(col) };
}

const COL_LEG = "#000000";
const COL_BACK = "#d2b48c";
const COL_TOP = "#8b7355";
const COL_MONITOR_SCREEN = "#000000";
const COL_MONITOR_BEZEL = "#dddddd";

const allPositions = [];
const allColors = [];

function addShapeData(data) {
  allPositions.push(...data.pos);
  allColors.push(...data.col);
}

addShapeData(createBoxData(-W / 2, -W / 2 + T, -H, 0, -D / 2, D / 2 - 1, COL_LEG));
addShapeData(createBoxData(W / 2 - T, W / 2, -H, 0, -D / 2, D / 2 - 1, COL_LEG));
addShapeData(createBoxData(-W / 2, W / 2, 0, T, -D / 2, D / 2, COL_TOP));
{
  const backHeight = H * 0.75, GAP = 1.5;
  const x1 = -W / 2 + T + GAP, x2 = W / 2 - T - GAP;
  const y1 = -backHeight, y2 = 0;
  const z1 = D / 2 - T - 2, z2 = D / 2 - 2;
  addShapeData(createBoxData(x1, x2, y1, y2, z1, z2, COL_BACK));
}

const monitorWidth = 120, monitorHeight = 90, monitorDepth = 15;
const standHeight = monitorHeight * 0.3;
const baseHeight = monitorDepth * 0.2;
const monitorZPosition = -D / 2 + monitorDepth / 2 + 10;
const monitorCenterX = 0;

const baseY_start = T;
const baseY_end = baseY_start + baseHeight;
const baseData = createBoxData(
  monitorCenterX - (monitorWidth * 0.6) / 2, monitorCenterX + (monitorWidth * 0.6) / 2,
  baseY_start, baseY_end,
  monitorZPosition - (monitorDepth * 0.8) / 2, monitorZPosition + (monitorDepth * 0.8) / 2,
  COL_MONITOR_BEZEL
);
addShapeData(baseData);

const standY_start = baseY_end;
const standY_end = standY_start + standHeight;
const standData = createBoxData(
  monitorCenterX - (monitorWidth * 0.1) / 2, monitorCenterX + (monitorWidth * 0.1) / 2,
  standY_start, standY_end,
  monitorZPosition - (monitorDepth * 0.5) / 2, monitorZPosition + (monitorDepth * 0.5) / 2,
  COL_MONITOR_BEZEL
);
addShapeData(standData);

const bezelHeight = monitorHeight;
const bezelY_start = standY_end;
const bezelY_end = bezelY_start + bezelHeight;
const bezelData = createBoxData(
  monitorCenterX - monitorWidth / 2, monitorCenterX + monitorWidth / 2,
  bezelY_start, bezelY_end,
  monitorZPosition - monitorDepth / 2, monitorZPosition + monitorDepth / 2,
  COL_MONITOR_BEZEL
);
addShapeData(bezelData);

const screenHeight = monitorHeight * 0.8;
const screenWidth = monitorWidth * 0.9;
const screenDepth = monitorDepth * 0.1;
const screenY_start = bezelY_start + (bezelHeight - screenHeight) / 2;
const screenY_end = screenY_start + screenHeight;
const screenZ_start = monitorZPosition - screenDepth / 2;
const screenZ_end = monitorZPosition + screenDepth / 2;

const screenData = createBoxData(
  monitorCenterX - screenWidth / 2, monitorCenterX + screenWidth / 2,
  screenY_start, screenY_end,
  screenZ_start, screenZ_end,
  COL_MONITOR_SCREEN
);
addShapeData(screenData);

const positionsArray = new Float32Array(allPositions);
const colorsArray = new Float32Array(allColors);

const posBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
gl.bufferData(gl.ARRAY_BUFFER, positionsArray, gl.STATIC_DRAW);

const colBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
gl.bufferData(gl.ARRAY_BUFFER, colorsArray, gl.STATIC_DRAW);

gl.enableVertexAttribArray(aPositionLoc);
gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
gl.vertexAttribPointer(aPositionLoc, 3, gl.FLOAT, false, 0, 0);

gl.enableVertexAttribArray(aColorLoc);
gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
gl.vertexAttribPointer(aColorLoc, 3, gl.FLOAT, false, 0, 0);

gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL);
gl.disable(gl.CULL_FACE);
gl.clearColor(1.0, 1.0, 1.0, 1.0);

function deg2rad(d) { return d * Math.PI / 180; }

function draw() {
  const now = performance.now();
  const dt = Math.max(0, (now - lastTime) / 1000);
  lastTime = now;

  if (autoRotate) {
    rotX += (SPD.x * Math.PI / 180) * dt;
    rotY += (SPD.y * Math.PI / 180) * dt;
    rotZ += (SPD.z * Math.PI / 180) * dt;

    rotXEl.value = Math.round(rotX * 180 / Math.PI);
    rotYEl.value = Math.round(rotY * 180 / Math.PI);
    rotZEl.value = Math.round(rotZ * 180 / Math.PI);
    valRotX.textContent = rotXEl.value + "°";
    valRotY.textContent = rotYEl.value + "°";
    valRotZ.textContent = rotZEl.value + "°";
  }

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const aspect = canvas.width / canvas.height;
  const proj = Mat4.perspective(deg2rad(45), aspect, NEAR, FAR);
  const view = Mat4.translate(0, 0, -CAM_Z);
  let model = Mat4.translate(pos.x, pos.y, pos.z);
  model = Mat4.multiply(model, Mat4.rotateX(rotX));
  model = Mat4.multiply(model, Mat4.rotateY(rotY));
  model = Mat4.multiply(model, Mat4.rotateZ(rotZ));
  let vp = Mat4.multiply(proj, view);
  let mvp = Mat4.multiply(vp, model);
  gl.uniformMatrix4fv(uMVPLoc, false, mvp);

  const totalVertices = positionsArray.length / 3;
  gl.drawArrays(gl.TRIANGLES, 0, totalVertices);

  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

function setLabel(el, lab) { lab.textContent = `${el.value}°`; }

rotX = deg2rad(+rotXEl.value);
rotY = deg2rad(+rotYEl.value);
rotZ = deg2rad(+rotZEl.value);
setLabel(rotXEl, valRotX); setLabel(rotYEl, valRotY); setLabel(rotZEl, valRotZ);

rotXEl.oninput = () => { rotX = deg2rad(+rotXEl.value); setLabel(rotXEl, valRotX); };
rotYEl.oninput = () => { rotY = deg2rad(+rotYEl.value); setLabel(rotYEl, valRotY); };
rotZEl.oninput = () => { rotZ = deg2rad(+rotZEl.value); setLabel(rotZEl, valRotZ); };

toggleAutoBtn.onclick = () => {
  autoRotate = !autoRotate;
  toggleAutoBtn.textContent = autoRotate ? "Stop" : "Start";
};
window.addEventListener('keydown', (e) => {
  if ((e.key === 'r' || e.key === 'R') && !e.repeat) {
    autoRotate = !autoRotate;
    toggleAutoBtn.textContent = autoRotate ? "Stop" : "Start";
  }
});

const STEP = 20, STEP_Z = 10;
function showPos() { posReadout.textContent = `Posisi: x=${pos.x}, y=${pos.y}, z=${pos.z}`; }
showPos();

btn.xMinus.onclick = () => { pos.x -= STEP; showPos(); };
btn.xPlus.onclick = () => { pos.x += STEP; showPos(); };
btn.yMinus.onclick = () => { pos.y -= STEP; showPos(); };
btn.yPlus.onclick = () => { pos.y += STEP; showPos(); };
btn.zMinus.onclick = () => { pos.z += STEP_Z; showPos(); };
btn.zPlus.onclick = () => { pos.z -= STEP_Z; showPos(); };

window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
  if (tag === 'input' || tag === 'textarea') return;
  let moved = false;
  switch (e.key) {
    case 'ArrowLeft': case 'a': case 'A': pos.x -= STEP; moved = true; break;
    case 'ArrowRight': case 'd': case 'D': pos.x += STEP; moved = true; break;
    case 'ArrowUp': case 'w': case 'W': pos.y += STEP; moved = true; break;
    case 'ArrowDown': case 's': case 'S': pos.y -= STEP; moved = true; break;
    case 'q': case 'Q': pos.z -= STEP_Z; moved = true; break;
    case 'e': case 'E': pos.z += STEP_Z; moved = true; break;
  }
  if (moved) { e.preventDefault(); showPos(); }
});