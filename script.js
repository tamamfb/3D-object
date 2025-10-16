// ===== Canvas & GL =====
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

// ===== Camera =====
const NEAR = 8;
const FAR = 2000;
const FOV = 45;

const CAM_VIEWS = {
  front:  { x: 0,   y: 0, z: 600,  rotX: 0,   rotY: 0   },
  back:   { x: 0,   y: 0, z: -600, rotX: 0,   rotY: 180 },
  left:   { x: -600,y: 0, z: 0,    rotX: 0,   rotY: 90  },
  right:  { x: 600, y: 0, z: 0,    rotX: 0,   rotY: -90 },
};

let camPos = { x: 0, y: 0, z: 600 };
let camRot = { x: 0, y: 0, z: 0 };

// ===== Model params =====
const W = 300, D = 180, H = 150, T = 10;

let rotX = 0, rotY = 0, rotZ = 0;
let pos = { x: 0, y: 0, z: 0 };
let autoRotate = false;
const SPD = { x: 20, y: 30, z: 15 };
let lastTime = performance.now();

// ===== UI refs (dipakai semua seperti semula) =====
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
  back:  document.getElementById("viewBack"),
  left:  document.getElementById("viewLeft"),
  right: document.getElementById("viewRight"),
};
const enableAmbient  = document.getElementById("enableAmbient");
const enableDiffuse  = document.getElementById("enableDiffuse");
const enableSpecular = document.getElementById("enableSpecular");
const colorAmbient   = document.getElementById("colorAmbient");
const colorDiffuse   = document.getElementById("colorDiffuse");
const colorSpecular  = document.getElementById("colorSpecular");
const shininessEl    = document.getElementById("shininess");
const shininessVal   = document.getElementById("shininessVal");
const lightX = document.getElementById("lightX");
const lightY = document.getElementById("lightY");
const lightZ = document.getElementById("lightZ");
function updateLightPosReadout(){
  const el = document.getElementById("lightPosReadout");
  if (el) el.textContent = `Light: x=${lightX.value}, y=${lightY.value}, z=${lightZ.value}`;
}
shininessEl.oninput = () => shininessVal.textContent = shininessEl.value;
[lightX, lightY, lightZ].forEach(el => el.oninput = updateLightPosReadout);
updateLightPosReadout();

// ===== GL helpers =====
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
  gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(p));
    gl.deleteProgram(p); return null;
  }
  return p;
}
function hexToRgbNorm(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255];
}

// ===== Mat4 =====
const Mat4 = {
  identity(){ return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); },
  multiply(a,b){
    const o=new Float32Array(16);
    for(let i=0;i<4;i++) for(let j=0;j<4;j++){
      let s=0; for(let k=0;k<4;k++) s+=a[k*4+j]*b[i*4+k]; o[i*4+j]=s;
    }
    return o;
  },
  translate(tx,ty,tz){ const m=Mat4.identity(); m[12]=tx; m[13]=ty; m[14]=tz; return m; },
  rotateX(a){ const c=Math.cos(a), s=Math.sin(a); return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]); },
  rotateY(a){ const c=Math.cos(a), s=Math.sin(a); return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]); },
  rotateZ(a){ const c=Math.cos(a), s=Math.sin(a); return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]); },
  perspective(fovy, aspect, near, far){
    const f=1/Math.tan(fovy/2), nf=1/(near-far), o=new Float32Array(16);
    o[0]=f/aspect; o[5]=f; o[10]=(far+near)*nf; o[11]=-1; o[14]=(2*far*near)*nf; return o;
  }
};

// ===== Shaders =====
const vsSource = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
attribute vec2 aTexCoord;
uniform mat4 uMVP;
uniform mat4 uModel;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vTexCoord;
void main(){
  vec4 worldPos = uModel * vec4(aPosition, 1.0);
  vPosition = worldPos.xyz;
  vNormal = mat3(uModel) * aNormal;
  vColor = aColor;
  vTexCoord = aTexCoord;
  gl_Position = uMVP * vec4(aPosition, 1.0);
}`;

const fsSource = `
precision mediump float;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vPosition;
varying vec2 vTexCoord;
uniform vec3 uLightPos;
uniform vec3 uViewPos;
uniform vec3 uAmbientColor;
uniform vec3 uDiffuseColor;
uniform vec3 uSpecularColor;
uniform bool uEnableAmbient;
uniform bool uEnableDiffuse;
uniform bool uEnableSpecular;
uniform float uShininess;
uniform sampler2D uTexture;
uniform bool uUseTexture;
void main(){
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightPos - vPosition);
  vec3 V = normalize(uViewPos - vPosition);
  vec3 R = reflect(-L, N);

  vec3 ambient = uEnableAmbient ? uAmbientColor : vec3(0.0);
  float diff = max(dot(N, L), 0.0);
  vec3 diffuse = uEnableDiffuse ? (diff * uDiffuseColor) : vec3(0.0);

  float spec=0.0;
  if(uEnableSpecular && diff>0.0){
    spec = pow(max(dot(R, V), 0.0), uShininess);
  }
  vec3 specular = uEnableSpecular ? (spec * uSpecularColor) : vec3(0.0);

  vec3 baseColor = uUseTexture ? texture2D(uTexture, vTexCoord).rgb : vColor;
  vec3 result = (ambient + diffuse + specular) * baseColor;
  gl_FragColor = vec4(result, 1.0);
}`;

// ===== Program & locations =====
const program = createProgram(vsSource, fsSource);
gl.useProgram(program);
const aPositionLoc = gl.getAttribLocation(program, "aPosition");
const aNormalLoc   = gl.getAttribLocation(program, "aNormal");
const aColorLoc    = gl.getAttribLocation(program, "aColor");
const aTexCoordLoc = gl.getAttribLocation(program, "aTexCoord");
const uMVPLoc      = gl.getUniformLocation(program, "uMVP");
const uModelLoc    = gl.getUniformLocation(program, "uModel");
const uTextureLoc  = gl.getUniformLocation(program, "uTexture");
const uUseTextureLoc = gl.getUniformLocation(program, "uUseTexture");
const uLightPosLoc = gl.getUniformLocation(program, "uLightPos");
const uViewPosLoc  = gl.getUniformLocation(program, "uViewPos");
const uAmbientLoc  = gl.getUniformLocation(program, "uAmbientColor");
const uDiffuseLoc  = gl.getUniformLocation(program, "uDiffuseColor");
const uSpecularLoc = gl.getUniformLocation(program, "uSpecularColor");
const uEnableAmbientLoc  = gl.getUniformLocation(program, "uEnableAmbient");
const uEnableDiffuseLoc  = gl.getUniformLocation(program, "uEnableDiffuse");
const uEnableSpecularLoc = gl.getUniformLocation(program, "uEnableSpecular");
const uShininessLoc      = gl.getUniformLocation(program, "uShininess");

// ===== Colors like reference image =====
const COL_LEG             = "#000000"; // kaki hitam
const COL_BACK            = "#d2b48c"; // panel depan beige
const COL_TOP             = "#5c4033"; // top coklat tua
const COL_MONITOR_SCREEN  = "#000000"; // layar hitam
const COL_MONITOR_BEZEL   = "#e8e8e8"; // putih keabu
const COL_OUTLINE         = "#000000";

// ===== Texture (checkerboard) =====
function createCheckerboardTexture() {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const size = 128, tileSize = 16;
  const data = new Uint8Array(size * size * 4);
  for (let i=0;i<size;i++){
    for (let j=0;j<size;j++){
      const idx = (i*size + j)*4;
      const isEven = ((Math.floor(i/tileSize)+Math.floor(j/tileSize))%2===0);
      const color = isEven ? 139 : 185; // dua nada coklat
      data[idx]   = color;
      data[idx+1] = Math.floor(color*0.7);
      data[idx+2] = Math.floor(color*0.4);
      data[idx+3] = 255;
    }
  }
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return tex;
}
const tableTexture = createCheckerboardTexture();
gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, tableTexture);
gl.uniform1i(uTextureLoc, 0);

// ===== Geometry creators =====
function createBoxData(x1,x2,y1,y2,z1,z2,color,isTable=false){
  const px = [
    [x1,y1,z1],[x2,y1,z1],[x2,y2,z1],[x1,y2,z1],
    [x1,y1,z2],[x2,y1,z2],[x2,y2,z2],[x1,y2,z2]
  ];
  // front, back, top, bottom, right, left
  const faces = [
    { idx:[0,1,2,3], n:[0,0,-1], tag:"front"  },
    { idx:[4,5,6,7], n:[0,0, 1], tag:"back"   },
    { idx:[3,2,6,7], n:[0,1, 0], tag:"top"    },
    { idx:[0,4,5,1], n:[0,-1,0], tag:"bottom" },
    { idx:[1,5,6,2], n:[1,0, 0], tag:"right"  },
    { idx:[0,3,7,4], n:[-1,0,0], tag:"left"   },
  ];

  const rgb = hexToRgbNorm(color);

  // pisah: solid vs textured
  const sPos=[], sCol=[], sNor=[], sTex=[];
  const tPos=[], tCol=[], tNor=[], tTex=[];

  for (const f of faces){
    const a=px[f.idx[0]], b=px[f.idx[1]], c=px[f.idx[2]], d=px[f.idx[3]];

    // dua triangle per face
    const facePos = [...a,...b,...c, ...a,...c,...d];
    const faceCol = [...Array(6)].flatMap(()=>rgb);
    const faceNor = [...Array(6)].flatMap(()=>f.n);

    // texcoord untuk top only (checkerboard lebih rapat -> 2x repeat)
    const faceTexTop = [0,0, 2,0, 2,2, 0,0, 2,2, 0,2];
    const faceTexZero = [0,0,0,0,0,0, 0,0,0,0,0,0];

    const goesTextured = isTable && f.tag==="top";
    if (goesTextured){
      tPos.push(...facePos); tCol.push(...faceCol); tNor.push(...faceNor); tTex.push(...faceTexTop);
    } else {
      sPos.push(...facePos); sCol.push(...faceCol); sNor.push(...faceNor); sTex.push(...faceTexZero);
    }
  }

  return {
    solid:   { pos:new Float32Array(sPos), col:new Float32Array(sCol), nor:new Float32Array(sNor), tex:new Float32Array(sTex) },
    textured:{ pos:new Float32Array(tPos), col:new Float32Array(tCol), nor:new Float32Array(tNor), tex:new Float32Array(tTex) }
  };
}

function createBoxOutline(x1,x2,y1,y2,z1,z2,color){
  const v = [
    [x1,y1,z1],[x2,y1,z1],[x2,y2,z1],[x1,y2,z1],
    [x1,y1,z2],[x2,y1,z2],[x2,y2,z2],[x1,y2,z2]
  ];
  const edges=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  const pos=[], col=[]; const rgb=hexToRgbNorm(color);
  for (const [a,b] of edges){
    pos.push(...v[a], ...v[b]);
    col.push(...rgb, ...rgb);
  }
  return { pos:new Float32Array(pos), col:new Float32Array(col) };
}

// ===== Build scene geometry (split solid vs textured) =====
const solidPos=[], solidCol=[], solidNor=[], solidTex=[];
const texPos=[],   texCol=[],   texNor=[],   texTex=[];
function pushGeom(obj){
  solidPos.push(...obj.solid.pos); solidCol.push(...obj.solid.col);
  solidNor.push(...obj.solid.nor); solidTex.push(...obj.solid.tex);
  texPos.push(...obj.textured.pos); texCol.push(...obj.textured.col);
  texNor.push(...obj.textured.nor); texTex.push(...obj.textured.tex);
}

const outlinePositions=[], outlineColors=[];
function pushOutline(outl){ outlinePositions.push(...outl.pos); outlineColors.push(...outl.col); }

// Kaki kiri
let box = createBoxData(-W/2, -W/2+T, -H, 0, -D/2, D/2-1, COL_LEG);
pushGeom(box); pushOutline(createBoxOutline(-W/2, -W/2+T, -H, 0, -D/2, D/2-1, COL_OUTLINE));
// Kaki kanan
box = createBoxData(W/2-T, W/2, -H, 0, -D/2, D/2-1, COL_LEG);
pushGeom(box); pushOutline(createBoxOutline(W/2-T, W/2, -H, 0, -D/2, D/2-1, COL_OUTLINE));
// Top meja (checkerboard hanya di face atas)
box = createBoxData(-W/2, W/2, 0, T, -D/2, D/2, COL_TOP, true);
pushGeom(box); pushOutline(createBoxOutline(-W/2, W/2, 0, T, -D/2, D/2, COL_OUTLINE));
// Panel depan
{
  const backHeight = H * 0.75, GAP = 1.5;
  const x1 = -W/2 + T + GAP, x2 = W/2 - T - GAP;
  const y1 = -backHeight, y2 = 0;
  const z1 = D/2 - T - 2, z2 = D/2 - 2;
  box = createBoxData(x1,x2,y1,y2,z1,z2, COL_BACK);
  pushGeom(box); pushOutline(createBoxOutline(x1,x2,y1,y2,z1,z2, COL_OUTLINE));
}

// Monitor (base, stand, bezel, screen)
const monitorWidth=150, monitorHeight=110, monitorDepth=15;
const standHeight=monitorHeight*0.3, baseHeight=monitorDepth*0.22;
const monitorZ = D/2 - monitorDepth*0.5 - 12;
{
  // base
  let x1 = -(monitorWidth*0.6)/2, x2 = (monitorWidth*0.6)/2;
  let y1 = T, y2 = y1 + baseHeight;
  let z1 = monitorZ - (monitorDepth*0.8)/2, z2 = monitorZ + (monitorDepth*0.8)/2;
  box = createBoxData(x1,x2,y1,y2,z1,z2, COL_MONITOR_BEZEL);
  pushGeom(box); pushOutline(createBoxOutline(x1,x2,y1,y2,z1,z2, COL_OUTLINE));
}
{
  // stand
  let x1 = -(monitorWidth*0.1)/2, x2 = (monitorWidth*0.1)/2;
  let y1 = T + baseHeight, y2 = y1 + standHeight;
  let z1 = monitorZ - (monitorDepth*0.5)/2, z2 = monitorZ + (monitorDepth*0.5)/2;
  box = createBoxData(x1,x2,y1,y2,z1,z2, COL_MONITOR_BEZEL);
  pushGeom(box); pushOutline(createBoxOutline(x1,x2,y1,y2,z1,z2, COL_OUTLINE));
}
const bezelY_start = T + baseHeight + standHeight;
const bezelY_end   = bezelY_start + monitorHeight;
{
  // bezel
  let x1 = -monitorWidth/2, x2 = monitorWidth/2;
  let y1 = bezelY_start, y2 = bezelY_end;
  let z1 = monitorZ - monitorDepth/2, z2 = monitorZ + monitorDepth/2;
  box = createBoxData(x1,x2,y1,y2,z1,z2, COL_MONITOR_BEZEL);
  pushGeom(box); pushOutline(createBoxOutline(x1,x2,y1,y2,z1,z2, COL_OUTLINE));
}
{
  // screen
  const margin = 6;
  const sDepth = monitorDepth * 0.02;
  let x1 = -monitorWidth/2 + margin, x2 = monitorWidth/2 - margin;
  let y1 = bezelY_start + margin,  y2 = bezelY_end - margin;
  let zFace = monitorZ - monitorDepth/2 - 0.1;
  let z1 = zFace, z2 = zFace + sDepth;
  box = createBoxData(x1,x2,y1,y2,z1,z2, COL_MONITOR_SCREEN);
  pushGeom(box); pushOutline(createBoxOutline(x1,x2,y1,y2,z1,z2, COL_OUTLINE));
}

// ===== Typed arrays =====
const solidPositionsArray = new Float32Array(solidPos);
const solidColorsArray    = new Float32Array(solidCol);
const solidNormalsArray   = new Float32Array(solidNor);
const solidTexCoordsArray = new Float32Array(solidTex);

const texturedPositionsArray = new Float32Array(texPos);
const texturedColorsArray    = new Float32Array(texCol);
const texturedNormalsArray   = new Float32Array(texNor);
const texturedTexCoordsArray = new Float32Array(texTex);

const outlinePosArray = new Float32Array(outlinePositions);
const outlineColArray = new Float32Array(outlineColors);

// ===== Buffers (solid) =====
const solidPosBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, solidPosBuffer);
gl.bufferData(gl.ARRAY_BUFFER, solidPositionsArray, gl.STATIC_DRAW);

const solidNorBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, solidNorBuffer);
gl.bufferData(gl.ARRAY_BUFFER, solidNormalsArray, gl.STATIC_DRAW);

const solidColBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, solidColBuffer);
gl.bufferData(gl.ARRAY_BUFFER, solidColorsArray, gl.STATIC_DRAW);

const solidTexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, solidTexBuffer);
gl.bufferData(gl.ARRAY_BUFFER, solidTexCoordsArray, gl.STATIC_DRAW);

// ===== Buffers (textured top) =====
const texPosBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, texPosBuffer);
gl.bufferData(gl.ARRAY_BUFFER, texturedPositionsArray, gl.STATIC_DRAW);

const texNorBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, texNorBuffer);
gl.bufferData(gl.ARRAY_BUFFER, texturedNormalsArray, gl.STATIC_DRAW);

const texColBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, texColBuffer);
gl.bufferData(gl.ARRAY_BUFFER, texturedColorsArray, gl.STATIC_DRAW);

const texTcBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, texTcBuffer);
gl.bufferData(gl.ARRAY_BUFFER, texturedTexCoordsArray, gl.STATIC_DRAW);

// ===== Buffers (outline) =====
const outlinePosBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, outlinePosBuffer);
gl.bufferData(gl.ARRAY_BUFFER, outlinePosArray, gl.STATIC_DRAW);

const outlineColBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, outlineColBuffer);
gl.bufferData(gl.ARRAY_BUFFER, outlineColArray, gl.STATIC_DRAW);

// ===== GL states =====
gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL);
gl.disable(gl.CULL_FACE);
gl.clearColor(1,1,1,1);

gl.enable(gl.POLYGON_OFFSET_FILL);
gl.polygonOffset(1,1);

// ===== utils =====
function rad2deg(r){ return r * 180/Math.PI; }
function deg2rad(d){ return d * Math.PI/180; }
function wrapDeg(d){ d=((d+180)%360+360)%360-180; return d; }
function updateSlidersFromRotation(){
  rotXEl.value = wrapDeg(rad2deg(rotX));
  rotYEl.value = wrapDeg(rad2deg(rotY));
  rotZEl.value = wrapDeg(rad2deg(rotZ));
  valRotX.textContent = rotXEl.value + "°";
  valRotY.textContent = rotYEl.value + "°";
  valRotZ.textContent = rotZEl.value + "°";
}
function setCameraView(view){
  camPos.x = view.x; camPos.y = view.y; camPos.z = view.z;
  camRot.x = deg2rad(view.rotX||0);
  camRot.y = deg2rad(view.rotY||0);
  camRot.z = deg2rad(view.rotZ||0);
}
let light = { x:+lightX.value, y:+lightY.value, z:+lightZ.value };

// ===== Draw loop =====
function draw(){
  const now = performance.now();
  const dt = Math.max(0, (now-lastTime)/1000);
  lastTime = now;

  if (autoRotate){
    rotX += (SPD.x * Math.PI/180) * dt;
    rotY += (SPD.y * Math.PI/180) * dt;
    rotZ += (SPD.z * Math.PI/180) * dt;
    updateSlidersFromRotation();
  }

  light.x = +lightX.value; light.y = +lightY.value; light.z = +lightZ.value;

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const aspect = canvas.width / canvas.height;
  const proj = Mat4.perspective(deg2rad(FOV), aspect, NEAR, FAR);

  // view = Rz * Ry * Rx * T
  let view = Mat4.translate(-camPos.x, -camPos.y, -camPos.z);
  view = Mat4.multiply(Mat4.rotateX(camRot.x), view);
  view = Mat4.multiply(Mat4.rotateY(camRot.y), view);
  view = Mat4.multiply(Mat4.rotateZ(camRot.z), view);

  // model = T * Rx * Ry * Rz
  let model = Mat4.translate(pos.x, pos.y, pos.z);
  model = Mat4.multiply(model, Mat4.rotateX(rotX));
  model = Mat4.multiply(model, Mat4.rotateY(rotY));
  model = Mat4.multiply(model, Mat4.rotateZ(rotZ));

  const vp = Mat4.multiply(proj, view);
  const mvp = Mat4.multiply(vp, model);
  gl.uniformMatrix4fv(uMVPLoc, false, mvp);
  gl.uniformMatrix4fv(uModelLoc, false, model);

  // lighting uniforms
  gl.uniform3f(uViewPosLoc, camPos.x, camPos.y, camPos.z);
  gl.uniform3f(uLightPosLoc, light.x, light.y, light.z);
  const amb = hexToRgbNorm(colorAmbient.value);
  const dif = hexToRgbNorm(colorDiffuse.value);
  const spec = hexToRgbNorm(colorSpecular.value);
  gl.uniform3f(uAmbientLoc,  amb[0], amb[1], amb[2]);
  gl.uniform3f(uDiffuseLoc,  dif[0], dif[1], dif[2]);
  gl.uniform3f(uSpecularLoc, spec[0], spec[1], spec[2]);
  gl.uniform1i(uEnableAmbientLoc,  enableAmbient.checked ? 1 : 0);
  gl.uniform1i(uEnableDiffuseLoc,  enableDiffuse.checked ? 1 : 0);
  gl.uniform1i(uEnableSpecularLoc, enableSpecular.checked ? 1 : 0);
  gl.uniform1f(uShininessLoc, +shininessEl.value);

  // ---- draw SOLID (tanpa texture) ----
  gl.uniform1i(uUseTextureLoc, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, solidPosBuffer);
  gl.vertexAttribPointer(aPositionLoc, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aPositionLoc);

  gl.bindBuffer(gl.ARRAY_BUFFER, solidNorBuffer);
  gl.vertexAttribPointer(aNormalLoc, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aNormalLoc);

  gl.bindBuffer(gl.ARRAY_BUFFER, solidColBuffer);
  gl.vertexAttribPointer(aColorLoc, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aColorLoc);

  gl.bindBuffer(gl.ARRAY_BUFFER, solidTexBuffer);
  gl.vertexAttribPointer(aTexCoordLoc, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aTexCoordLoc);

  gl.drawArrays(gl.TRIANGLES, 0, solidPositionsArray.length/3);

  // ---- draw TEXTURED (checkerboard top) ----
  gl.uniform1i(uUseTextureLoc, 1);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tableTexture);

  gl.bindBuffer(gl.ARRAY_BUFFER, texPosBuffer);
  gl.vertexAttribPointer(aPositionLoc, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, texNorBuffer);
  gl.vertexAttribPointer(aNormalLoc, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, texColBuffer);
  gl.vertexAttribPointer(aColorLoc, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, texTcBuffer);
  gl.vertexAttribPointer(aTexCoordLoc, 2, gl.FLOAT, false, 0, 0);

  gl.drawArrays(gl.TRIANGLES, 0, texturedPositionsArray.length/3);

  // ---- draw OUTLINE ----
  gl.uniform1i(uUseTextureLoc, 0); // outline tidak pakai texture
  gl.bindBuffer(gl.ARRAY_BUFFER, outlinePosBuffer);
  gl.vertexAttribPointer(aPositionLoc, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aPositionLoc);

  gl.bindBuffer(gl.ARRAY_BUFFER, outlineColBuffer);
  gl.vertexAttribPointer(aColorLoc, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aColorLoc);

  gl.lineWidth(1);
  gl.drawArrays(gl.LINES, 0, outlinePosArray.length/3);

  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// ===== Controls (sama seperti semula) =====
function setLabel(el, lab){ lab.textContent = `${el.value}°`; }
rotX = deg2rad(+rotXEl.value);
rotY = deg2rad(+rotYEl.value);
rotZ = deg2rad(+rotZEl.value);
setLabel(rotXEl, valRotX); setLabel(rotYEl, valRotY); setLabel(rotZEl, valRotZ);

rotXEl.oninput = ()=>{ rotX = deg2rad(+rotXEl.value); setLabel(rotXEl, valRotX); };
rotYEl.oninput = ()=>{ rotY = deg2rad(+rotYEl.value); setLabel(rotYEl, valRotY); };
rotZEl.oninput = ()=>{ rotZ = deg2rad(+rotZEl.value); setLabel(rotZEl, valRotZ); };

viewButtons.front.onclick = ()=> setCameraView(CAM_VIEWS.front);
viewButtons.back.onclick  = ()=> setCameraView(CAM_VIEWS.back);
viewButtons.left.onclick  = ()=> setCameraView(CAM_VIEWS.left);
viewButtons.right.onclick = ()=> setCameraView(CAM_VIEWS.right);

toggleAutoBtn.onclick = ()=>{
  autoRotate = !autoRotate;
  toggleAutoBtn.textContent = autoRotate ? "Stop" : "Start";
};
window.addEventListener("keydown", (e)=>{
  if ((e.key==='r'||e.key==='R') && !e.repeat){
    autoRotate = !autoRotate;
    toggleAutoBtn.textContent = autoRotate ? "Stop" : "Start";
  }
});

// posisi object
const STEP = 20, STEP_Z = 10;
function showPos(){ const el=document.getElementById("posReadout"); if(el) el.textContent = `Posisi: x=${pos.x}, y=${pos.y}, z=${pos.z}`; }
showPos();

btn.xMinus.onclick = ()=>{ pos.x -= STEP; showPos(); };
btn.xPlus.onclick  = ()=>{ pos.x += STEP; showPos(); };
btn.yMinus.onclick = ()=>{ pos.y -= STEP; showPos(); };
btn.yPlus.onclick  = ()=>{ pos.y += STEP; showPos(); };
btn.zMinus.onclick = ()=>{ pos.z += STEP_Z; showPos(); };
btn.zPlus.onclick  = ()=>{ pos.z -= STEP_Z; showPos(); };

window.addEventListener("keydown",(e)=>{
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
  if (tag==='input' || tag==='textarea') return;
  let moved=false;
  switch(e.key){
    case 'ArrowLeft': case 'a': case 'A': pos.x -= STEP; moved=true; break;
    case 'ArrowRight':case 'd': case 'D': pos.x += STEP; moved=true; break;
    case 'ArrowUp':   case 'w': case 'W': pos.y += STEP; moved=true; break;
    case 'ArrowDown': case 's': case 'S': pos.y -= STEP; moved=true; break;
    case 'q': case 'Q': pos.z -= STEP_Z; moved=true; break;
    case 'e': case 'E': pos.z += STEP_Z; moved=true; break;
  }
  if (moved){ e.preventDefault(); showPos(); }
});
