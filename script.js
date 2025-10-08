const canvas = document.getElementById("myCanvas");
const gl = canvas.getContext("webgl", { antialias: true });
if (!gl) { alert("WebGL tidak tersedia di browser ini."); }

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

const NEAR = 8;
const FAR = 2000;
const FOV = 45;

const CAM_VIEWS = {
    front:   { x: 0, y: 0, z: 600, rotX: 0, rotY: 0 },
    back:    { x: 0, y: 0, z: -600, rotX: 0, rotY: 180 },
    left:    { x: -600, y: 0, z: 0, rotX: 0, rotY: 90 },
    right:   { x: 600, y: 0, z: 0, rotX: 0, rotY: -90 },
};

let camPos = { x: 0, y: 0, z: 600 };
let camRot = { x: 0, y: 0, z: 0 };

const W = 300, D = 180, H = 150, T = 10;

let rotX = 0, rotY = 0, rotZ = 0;
let pos = { x: 0, y: 0, z: 0 };
let autoRotate = false;
const SPD = { x: 20, y: 30, z: 15 };
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

const viewButtons = {
    front: document.getElementById("viewFront"),
    back: document.getElementById("viewBack"),
    left: document.getElementById("viewLeft"),
    right: document.getElementById("viewRight"),
};

// --- UI lighting elements ---
const enableAmbient = document.getElementById("enableAmbient");
const enableDiffuse = document.getElementById("enableDiffuse");
const enableSpecular = document.getElementById("enableSpecular");
const colorAmbient = document.getElementById("colorAmbient");
const colorDiffuse = document.getElementById("colorDiffuse");
const colorSpecular = document.getElementById("colorSpecular");
const shininessEl = document.getElementById("shininess");
const shininessVal = document.getElementById("shininessVal");
const lightX = document.getElementById("lightX");
const lightY = document.getElementById("lightY");
const lightZ = document.getElementById("lightZ");
const lightPosReadout = document.getElementById("lightPosReadout");

shininessEl.oninput = () => shininessVal.textContent = shininessEl.value;
function updateLightPosReadout(){ lightPosReadout.textContent = `Light: x=${lightX.value}, y=${lightY.value}, z=${lightZ.value}`; }
[lightX, lightY, lightZ].forEach(el => el.oninput = updateLightPosReadout);
updateLightPosReadout();

// --- shader helpers ---
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

// --- Mat4 (sama seperti sebelumnya) ---
const Mat4 = {
    identity() { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); },
    multiply(a, b) {
        const out = new Float32Array(16);
        for (let i=0;i<4;i++) for (let j=0;j<4;j++) {
            let s=0; for (let k=0;k<4;k++) s += a[k*4+j]*b[i*4+k];
            out[i*4+j]=s;
        }
        return out;
    },
    translate(tx, ty, tz) { const m=Mat4.identity(); m[12]=tx; m[13]=ty; m[14]=tz; return m; },
    rotateX(a){ const c=Math.cos(a), s=Math.sin(a); return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]); },
    rotateY(a){ const c=Math.cos(a), s=Math.sin(a); return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]); },
    rotateZ(a){ const c=Math.cos(a), s=Math.sin(a); return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]); },
    perspective(fovy, aspect, near, far){
        const f=1/Math.tan(fovy/2), nf=1/(near-far), o=new Float32Array(16);
        o[0]=f/aspect; o[5]=f; o[10]=(far+near)*nf; o[11]=-1; o[14]=(2*far*near)*nf;
        return o;
    }
};

// --- Shaders (vertex -> pass normal & position) ---
const vsSource = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform mat4 uMVP;
uniform mat4 uModel; // untuk world space posisi & normal transform
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vPosition;
void main(){
    vec4 worldPos = uModel * vec4(aPosition, 1.0);
    vPosition = worldPos.xyz;
    // normal: model is assumed to be rigid (no non-uniform scale). For safety we don't compute inverse-transpose here.
    vNormal = mat3(uModel) * aNormal;
    vColor = aColor;
    gl_Position = uMVP * vec4(aPosition, 1.0);
}`;

// fragment shader: Phong lighting per-fragment
const fsSource = `
precision mediump float;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vPosition;
uniform vec3 uLightPos;
uniform vec3 uViewPos;
uniform vec3 uAmbientColor;
uniform vec3 uDiffuseColor;
uniform vec3 uSpecularColor;
uniform bool uEnableAmbient;
uniform bool uEnableDiffuse;
uniform bool uEnableSpecular;
uniform float uShininess;
void main(){
    vec3 N = normalize(vNormal);
    vec3 L = normalize(uLightPos - vPosition);
    vec3 V = normalize(uViewPos - vPosition);
    vec3 R = reflect(-L, N);
    // ambient
    vec3 ambient = uEnableAmbient ? uAmbientColor : vec3(0.0);
    // diffuse (Lambert)
    float diff = max(dot(N, L), 0.0);
    vec3 diffuse = uEnableDiffuse ? (diff * uDiffuseColor) : vec3(0.0);
    // specular (Blinn-Phong would use half vector; use Phong reflect)
    float spec = 0.0;
    if(uEnableSpecular && diff > 0.0){
        spec = pow(max(dot(R, V), 0.0), uShininess);
    }
    vec3 specular = uEnableSpecular ? (spec * uSpecularColor) : vec3(0.0);
    // combine, modulate by vertex color
    vec3 result = (ambient + diffuse + specular) * vColor;
    gl_FragColor = vec4(result, 1.0);
}`;

// create program
const program = createProgram(vsSource, fsSource);
gl.useProgram(program);

// attribute/uniform locations
const aPositionLoc = gl.getAttribLocation(program, "aPosition");
const aNormalLoc   = gl.getAttribLocation(program, "aNormal");
const aColorLoc    = gl.getAttribLocation(program, "aColor");
const uMVPLoc      = gl.getUniformLocation(program, "uMVP");
const uModelLoc    = gl.getUniformLocation(program, "uModel");
const uLightPosLoc = gl.getUniformLocation(program, "uLightPos");
const uViewPosLoc  = gl.getUniformLocation(program, "uViewPos");
const uAmbientLoc  = gl.getUniformLocation(program, "uAmbientColor");
const uDiffuseLoc  = gl.getUniformLocation(program, "uDiffuseColor");
const uSpecularLoc = gl.getUniformLocation(program, "uSpecularColor");
const uEnableAmbientLoc  = gl.getUniformLocation(program, "uEnableAmbient");
const uEnableDiffuseLoc  = gl.getUniformLocation(program, "uEnableDiffuse");
const uEnableSpecularLoc = gl.getUniformLocation(program, "uEnableSpecular");
const uShininessLoc = gl.getUniformLocation(program, "uShininess");

// --- Geometry building with normals ---
// function createBoxData now returns normals too
function createBoxData(x1, x2, y1, y2, z1, z2, color) {
    const px = [
        [x1, y1, z1],[x2, y1, z1],[x2, y2, z1],[x1, y2, z1],
        [x1, y1, z2],[x2, y1, z2],[x2, y2, z2],[x1, y2, z2]
    ];
    // faces: each face is quad with known normal
    const faces = [
        { idx:[0,1,2,3], n:[0,0,-1] }, // front (z1)
        { idx:[4,5,6,7], n:[0,0,1] },  // back (z2)
        { idx:[3,2,6,7], n:[0,1,0] },  // top (y2)
        { idx:[0,4,5,1], n:[0,-1,0] }, // bottom (y1)
        { idx:[1,5,6,2], n:[1,0,0] },  // right (x2)
        { idx:[0,3,7,4], n:[-1,0,0] }  // left (x1)
    ];
    const pos=[], col=[], nor=[];
    const rgb = hexToRgbNorm(color);
    for (const f of faces){
        const a=px[f.idx[0]], b=px[f.idx[1]], c=px[f.idx[2]], d=px[f.idx[3]];
        // two triangles: a,b,c  and a,c,d
        pos.push(a[0],a[1],a[2], b[0],b[1],b[2], c[0],c[1],c[2]);
        pos.push(a[0],a[1],a[2], c[0],c[1],c[2], d[0],d[1],d[2]);
        for (let k=0;k<6;k++){
            col.push(rgb[0],rgb[1],rgb[2]);
            nor.push(f.n[0], f.n[1], f.n[2]);
        }
    }
    return { pos:new Float32Array(pos), col:new Float32Array(col), nor:new Float32Array(nor) };
}

function createBoxOutline(x1, x2, y1, y2, z1, z2, color){
    const v=[
        [x1,y1,z1],[x2,y1,z1],[x2,y2,z1],[x1,y2,z1],
        [x1,y1,z2],[x2,y1,z2],[x2,y2,z2],[x1,y2,z2]
    ];
    const edges=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    const pos=[], col=[];
    const rgb=hexToRgbNorm(color);
    for (const [a,b] of edges){
        pos.push(v[a][0],v[a][1],v[a][2], v[b][0],v[b][1],v[b][2]);
        col.push(rgb[0],rgb[1],rgb[2], rgb[0],rgb[1],rgb[2]);
    }
    return { pos:new Float32Array(pos), col:new Float32Array(col) };
}

const COL_LEG    = "#000000";
const COL_BACK   = "#d2b48c";
const COL_TOP    = "#8b7355";
const COL_MONITOR_SCREEN = "#000000";
const COL_MONITOR_BEZEL  = "#ffffff";
const COL_OUTLINE = "#000000";

const allPositions = [];
const allColors    = [];
const allNormals   = [];
const outlinePositions = [];
const outlineColors    = [];

function addShapeData(d){ allPositions.push(...d.pos); allColors.push(...d.col); allNormals.push(...d.nor); }
function addOutlineData(d){ outlinePositions.push(...d.pos); outlineColors.push(...d.col); }

// --- create same geometry as sebelumnya, but using new functions ---
let d = createBoxData(-W/2, -W/2 + T, -H, 0, -D/2, D/2 - 1, COL_LEG);
addShapeData(d); addOutlineData(createBoxOutline(-W/2, -W/2 + T, -H, 0, -D/2, D/2 - 1, COL_OUTLINE));
d = createBoxData(W/2 - T, W/2, -H, 0, -D/2, D/2 - 1, COL_LEG);
addShapeData(d); addOutlineData(createBoxOutline(W/2 - T, W/2, -H, 0, -D/2, D/2 - 1, COL_OUTLINE));
d = createBoxData(-W/2, W/2, 0, T, -D/2, D/2, COL_TOP);
addShapeData(d); addOutlineData(createBoxOutline(-W/2, W/2, 0, T, -D/2, D/2, COL_OUTLINE));
{
    const backHeight = H * 0.75, GAP = 1.5;
    const x1 = -W / 2 + T + GAP, x2 = W / 2 - T - GAP;
    const y1 = -backHeight, y2 = 0;
    const z1 = D / 2 - T - 2, z2 = D / 2 - 2;
    d = createBoxData(x1, x2, y1, y2, z1, z2, COL_BACK);
    addShapeData(d); addOutlineData(createBoxOutline(x1, x2, y1, y2, z1, z2, COL_OUTLINE));
}

const monitorWidth  = 150;
const monitorHeight = 110;
const monitorDepth  = 15;
const standHeight   = monitorHeight * 0.3;
const baseHeight    = monitorDepth * 0.22;

const monitorZPosition = D / 2 - monitorDepth * 0.5 - 12;
const monitorCenterX = 0;

{
    const x1 = monitorCenterX - (monitorWidth * 0.6) / 2;
    const x2 = monitorCenterX + (monitorWidth * 0.6) / 2;
    const y1 = T;
    const y2 = y1 + baseHeight;
    const z1 = monitorZPosition - (monitorDepth * 0.8) / 2;
    const z2 = monitorZPosition + (monitorDepth * 0.8) / 2;
    d = createBoxData(x1, x2, y1, y2, z1, z2, COL_MONITOR_BEZEL);
    addShapeData(d); addOutlineData(createBoxOutline(x1, x2, y1, y2, z1, z2, COL_OUTLINE));
}

{
    const x1 = monitorCenterX - (monitorWidth * 0.1) / 2;
    const x2 = monitorCenterX + (monitorWidth * 0.1) / 2;
    const y1 = T + baseHeight;
    const y2 = y1 + standHeight;
    const z1 = monitorZPosition - (monitorDepth * 0.5) / 2;
    const z2 = monitorZPosition + (monitorDepth * 0.5) / 2;
    d = createBoxData(x1, x2, y1, y2, z1, z2, COL_MONITOR_BEZEL);
    addShapeData(d); addOutlineData(createBoxOutline(x1, x2, y1, y2, z1, z2, COL_OUTLINE));
}

const bezelY_start = T + baseHeight + standHeight;
const bezelY_end   = bezelY_start + monitorHeight;
{
    const x1 = monitorCenterX - monitorWidth / 2;
    const x2 = monitorCenterX + monitorWidth / 2;
    const y1 = bezelY_start;
    const y2 = bezelY_end;
    const z1 = monitorZPosition - monitorDepth / 2;
    const z2 = monitorZPosition + monitorDepth / 2;
    d = createBoxData(x1, x2, y1, y2, z1, z2, COL_MONITOR_BEZEL);
    addShapeData(d); addOutlineData(createBoxOutline(x1, x2, y1, y2, z1, z2, COL_OUTLINE));
}
{
    const margin = 6;
    const sDepth = monitorDepth * 0.02;

    const x1 = monitorCenterX - monitorWidth / 2 + margin;
    const x2 = monitorCenterX + monitorWidth / 2 - margin;
    const y1 = bezelY_start + margin;
    const y2 = bezelY_end - margin;
    const zFace = monitorZPosition - monitorDepth / 2 - 0.1;
    const z1 = zFace;
    const z2 = zFace + sDepth;

    d = createBoxData(x1, x2, y1, y2, z1, z2, COL_MONITOR_SCREEN);
    addShapeData(d);
    addOutlineData(createBoxOutline(x1, x2, y1, y2, z1, z2, COL_OUTLINE));
}

// flatten arrays
const positionsArray = new Float32Array(allPositions);
const colorsArray = new Float32Array(allColors);
const normalsArray = new Float32Array(allNormals);
const outlinePosArray = new Float32Array(outlinePositions);
const outlineColArray = new Float32Array(outlineColors);

// create buffers
const posBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
gl.bufferData(gl.ARRAY_BUFFER, positionsArray, gl.STATIC_DRAW);

const colBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
gl.bufferData(gl.ARRAY_BUFFER, colorsArray, gl.STATIC_DRAW);

const norBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, norBuffer);
gl.bufferData(gl.ARRAY_BUFFER, normalsArray, gl.STATIC_DRAW);

const outlinePosBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, outlinePosBuffer);
gl.bufferData(gl.ARRAY_BUFFER, outlinePosArray, gl.STATIC_DRAW);

const outlineColBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, outlineColBuffer);
gl.bufferData(gl.ARRAY_BUFFER, outlineColArray, gl.STATIC_DRAW);

// enable attributes
gl.enableVertexAttribArray(aPositionLoc);
gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
gl.vertexAttribPointer(aPositionLoc, 3, gl.FLOAT, false, 0, 0);

gl.enableVertexAttribArray(aNormalLoc);
gl.bindBuffer(gl.ARRAY_BUFFER, norBuffer);
gl.vertexAttribPointer(aNormalLoc, 3, gl.FLOAT, false, 0, 0);

gl.enableVertexAttribArray(aColorLoc);
gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
gl.vertexAttribPointer(aColorLoc, 3, gl.FLOAT, false, 0, 0);

gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL);
gl.disable(gl.CULL_FACE);
gl.clearColor(1, 1, 1, 1);

gl.enable(gl.POLYGON_OFFSET_FILL);
gl.polygonOffset(1, 1);

function rad2deg(r){ return r * 180 / Math.PI; }
function deg2rad(d){ return d * Math.PI / 180; }
function wrapDeg(d){ d=((d+180)%360+360)%360-180; return d; }

function updateSlidersFromRotation(){
    rotXEl.value = wrapDeg(rad2deg(rotX));
    rotYEl.value = wrapDeg(rad2deg(rotY));
    rotZEl.value = wrapDeg(rad2deg(rotZ));
    valRotX.textContent = rotXEl.value + "°";
    valRotY.textContent = rotYEl.value + "°";
    valRotZ.textContent = rotZEl.value + "°";
}

function setCameraView(view) {
    camPos.x = view.x;
    camPos.y = view.y;
    camPos.z = view.z;
    camRot.x = deg2rad(view.rotX || 0);
    camRot.y = deg2rad(view.rotY || 0);
    camRot.z = deg2rad(view.rotZ || 0);
}

// initial light
let light = { x: +lightX.value, y: +lightY.value, z: +lightZ.value };

function draw(){
    const now = performance.now();
    const dt = Math.max(0, (now - lastTime)/1000);
    lastTime = now;

    if (autoRotate){
        rotX += (SPD.x * Math.PI/180) * dt;
        rotY += (SPD.y * Math.PI/180) * dt;
        rotZ += (SPD.z * Math.PI/180) * dt;
        updateSlidersFromRotation();
    }

    // update light from UI
    light.x = +lightX.value; light.y = +lightY.value; light.z = +lightZ.value;

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = canvas.width / canvas.height;
    const proj = Mat4.perspective(deg2rad(FOV), aspect, NEAR, FAR);

    let view = Mat4.translate(-camPos.x, -camPos.y, -camPos.z);
    view = Mat4.multiply(Mat4.rotateX(camRot.x), view);
    view = Mat4.multiply(Mat4.rotateY(camRot.y), view);
    view = Mat4.multiply(Mat4.rotateZ(camRot.z), view);

    let model = Mat4.translate(pos.x, pos.y, pos.z);
    model = Mat4.multiply(model, Mat4.rotateX(rotX));
    model = Mat4.multiply(model, Mat4.rotateY(rotY));
    model = Mat4.multiply(model, Mat4.rotateZ(rotZ));

    const vp  = Mat4.multiply(proj, view);
    const mvp = Mat4.multiply(vp, model);
    gl.uniformMatrix4fv(uMVPLoc, false, mvp);
    gl.uniformMatrix4fv(uModelLoc, false, model);

    // camera pos in world (inverse of view translate; camera at camPos)
    gl.uniform3f(uViewPosLoc, camPos.x, camPos.y, camPos.z);
    gl.uniform3f(uLightPosLoc, light.x, light.y, light.z);

    // pass lighting UI values
    const amb = hexToRgbNorm(colorAmbient.value);
    const dif = hexToRgbNorm(colorDiffuse.value);
    const spec = hexToRgbNorm(colorSpecular.value);
    gl.uniform3f(uAmbientLoc, amb[0], amb[1], amb[2]);
    gl.uniform3f(uDiffuseLoc, dif[0], dif[1], dif[2]);
    gl.uniform3f(uSpecularLoc, spec[0], spec[1], spec[2]);

    gl.uniform1i(uEnableAmbientLoc, enableAmbient.checked ? 1 : 0);
    gl.uniform1i(uEnableDiffuseLoc, enableDiffuse.checked ? 1 : 0);
    gl.uniform1i(uEnableSpecularLoc, enableSpecular.checked ? 1 : 0);
    gl.uniform1f(uShininessLoc, +shininessEl.value);

    // draw solid
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.vertexAttribPointer(aPositionLoc, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, norBuffer);
    gl.vertexAttribPointer(aNormalLoc, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuffer);
    gl.vertexAttribPointer(aColorLoc, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, positionsArray.length / 3);

    // draw outline on top
    gl.bindBuffer(gl.ARRAY_BUFFER, outlinePosBuffer);
    gl.vertexAttribPointer(aPositionLoc, 3, gl.FLOAT, false, 0, 0);
    // use outline color buffer for aColor
    gl.bindBuffer(gl.ARRAY_BUFFER, outlineColBuffer);
    gl.vertexAttribPointer(aColorLoc, 3, gl.FLOAT, false, 0, 0);
    gl.lineWidth(1);
    gl.drawArrays(gl.LINES, 0, outlinePosArray.length / 3);

    requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// UI helpers (rotation sliders)
function setLabel(el, lab){ lab.textContent = `${el.value}°`; }

rotX = deg2rad(+rotXEl.value);
rotY = deg2rad(+rotYEl.value);
rotZ = deg2rad(+rotZEl.value);
setLabel(rotXEl, valRotX); setLabel(rotYEl, valRotY); setLabel(rotZEl, valRotZ);

rotXEl.oninput = () => { rotX = deg2rad(+rotXEl.value); setLabel(rotXEl, valRotX); };
rotYEl.oninput = () => { rotY = deg2rad(+rotYEl.value); setLabel(rotYEl, valRotY); };
rotZEl.oninput = () => { rotZ = deg2rad(+rotZEl.value); setLabel(rotZEl, valRotZ); };

viewButtons.front.onclick  = () => { setCameraView(CAM_VIEWS.front); };
viewButtons.back.onclick   = () => { setCameraView(CAM_VIEWS.back); };
viewButtons.left.onclick   = () => { setCameraView(CAM_VIEWS.left); };
viewButtons.right.onclick  = () => { setCameraView(CAM_VIEWS.right); };

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
function showPos(){ posReadout.textContent = `Posisi: x=${pos.x}, y=${pos.y}, z=${pos.z}`; }
showPos();

btn.xMinus.onclick = () => { pos.x -= STEP; showPos(); };
btn.xPlus.onclick  = () => { pos.x += STEP; showPos(); };
btn.yMinus.onclick = () => { pos.y -= STEP; showPos(); };
btn.yPlus.onclick  = () => { pos.y += STEP; showPos(); };
btn.zMinus.onclick = () => { pos.z += STEP_Z; showPos(); };
btn.zPlus.onclick  = () => { pos.z -= STEP_Z; showPos(); };

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