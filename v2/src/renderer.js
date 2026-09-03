import { CONFIG } from './config.js';

const VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// The whole composite is one pass. Screen space is mapped into the head's own
// frame, so ink and deformation - both stored in that frame - follow the
// visitor without any per-mark bookkeeping.
const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;

uniform sampler2D uVideo;
uniform sampler2D uInk;
uniform sampler2D uDisp;
uniform sampler2D uMask;
uniform sampler2D uDepth;
uniform sampler2D uHandMask;

uniform float uAspect;
uniform vec2 uOrigin;
uniform vec2 uAxisU;
uniform vec2 uAxisV;
uniform float uScale;
uniform float uExtent;
uniform vec2 uFaceCentre;
uniform float uDeform;
uniform float uHasFace;
uniform float uHasMask;
uniform float uHasDepth;
uniform float uDepthRange;
uniform float uFaceRelief;
uniform float uSculpt;
uniform float uContrast;
uniform float uColour;
uniform float uBright;
uniform vec3 uPaper;
uniform float uReveal;
uniform float uScan;
uniform vec2 uEyeA;
uniform vec2 uEyeB;
uniform vec2 uEyeR;
uniform float uProtectEyes;
uniform float uLidA[32];
uniform float uLidB[32];
uniform float uEyeSoft;
uniform float uEyeDeformSoft;
uniform float uEyeDeformRound;
uniform float uEyeRigid;
uniform float uEyeDeformScale;
uniform float uEyeGrade;
uniform float uEyePunch;
uniform float uEyeLift;
uniform float uEyeGradeFrom;
uniform float uEyeGradeTo;
uniform float uInkTexel;
uniform float uPaintForm;
uniform float uPaintRelief;
uniform float uPaintGloss;
uniform float uPaintShadow;
uniform float uFormRelief;
uniform float uBodyOnly;
uniform float uHasHands;
uniform float uPixel;

const vec3 L = normalize(vec3(-0.45, -0.62, 0.65));

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

bool outside(vec2 p) {
  return p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0;
}

// Where the lid rim lies at this angle. The table comes straight off the
// eyelid landmarks, so the boundary is the lash line rather than an ellipse
// drawn around the whole socket, and paint can run right up to it.
float lidRadius(vec2 d, bool second) {
  float t = fract(atan(d.y, d.x) * 0.1591549431) * 32.0;
  int i = int(t);
  float f = t - float(i);
  int j = i == 31 ? 0 : i + 1;
  float r = second ? mix(uLidB[i], uLidB[j], f) : mix(uLidA[i], uLidA[j], f);
  // Never smaller than a fraction of the socket: an empty table would
  // otherwise read as "no eye here" and let paint straight over it.
  return max(r, min(uEyeR.x, uEyeR.y) * 0.25);
}

// How far the guard reaches in one direction. Paint follows the rim exactly;
// the deformation is held off over a rounder, wider area, because a socket
// squeezed shut looks far worse than one that resists a little too much.
float eyeReach(vec2 d, bool second, float round) {
  float lid = lidRadius(d, second);
  if (round <= 0.0) return lid;
  float wide = length(d) / max(length(d / uEyeR), 1e-4);
  return mix(lid, wide, round);
}

// Distance to an eye, in units of its own rim: 1 exactly at the lashes.
float eyeDist(vec2 f, float round) {
  vec2 da = f - uEyeA;
  vec2 db = f - uEyeB;
  return dot(da, da) < dot(db, db)
    ? length(da) / eyeReach(da, false, round)
    : length(db) / eyeReach(db, true, round);
}

// 1 well clear of the eyes, 0 inside one. Everything the visitor throws is
// multiplied by this, so the eyes stay open however wrecked the rest gets.
float eyeGuard(vec2 f, float scale, float soft, float round) {
  if (uProtectEyes < 0.5) return 1.0;
  return smoothstep(soft, 1.0, eyeDist(f, round) / scale);
}

vec2 dispAt(vec2 fp) {
  vec2 uv = uFaceCentre + fp / uExtent;
  if (outside(uv)) return vec2(0.0);
  return (texture(uDisp, uv).rg * 2.0 - 1.0) * uDeform;
}

// The displacement of the flesh surrounding an eye, as a single rigid motion.
// Handing this to the eye lets it travel with the face without being pulled
// out of shape, where holding it still made it look stuck on.
vec2 rigidAround(vec2 centre) {
  vec2 r = uEyeR * 1.6;
  vec2 sum = dispAt(centre + vec2(r.x, 0.0)) + dispAt(centre - vec2(r.x, 0.0))
           + dispAt(centre + vec2(0.0, r.y)) + dispAt(centre - vec2(0.0, r.y))
           + dispAt(centre + r * 0.72) + dispAt(centre - r * 0.72);
  return sum / 6.0;
}

// A soft blob over each eye, wider than the guard and with no hard edge,
// used only to grade the eye.
float eyeGrade(vec2 f) {
  if (uProtectEyes < 0.5) return 0.0;
  float a = length((f - uEyeA) / uEyeR);
  float b = length((f - uEyeB) / uEyeR);
  return 1.0 - smoothstep(uEyeGradeFrom, uEyeGradeTo, min(a, b));
}

float inkAt(vec2 fp) {
  vec2 uv = uFaceCentre + fp / uExtent;
  if (outside(uv)) return 0.0;
  return texture(uInk, uv).a;
}

// How buried an eye is: the paint immediately around it, ignoring the guard
// that keeps the eye itself clear. Nothing thrown yet means nothing to
// compensate for, and the eye is left exactly as the camera saw it.
float buried(vec2 centre) {
  float m = inkAt(centre);
  m = max(m, inkAt(centre + vec2(uEyeR.x * 1.5, 0.0)));
  m = max(m, inkAt(centre - vec2(uEyeR.x * 1.5, 0.0)));
  m = max(m, inkAt(centre + vec2(0.0, uEyeR.y * 1.8)));
  m = max(m, inkAt(centre - vec2(0.0, uEyeR.y * 1.8)));
  return m;
}

// Luminance of the camera at a point in display space.
float lumAt(vec2 s) {
  vec3 c = texture(uVideo, vec2(1.0 - s.x, s.y)).rgb;
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  // Aspect-corrected screen space: the same units the head frame is built in.
  vec2 s = vec2(vUv.x * uAspect, vUv.y);
  vec2 rel = s - uOrigin;
  vec2 f = vec2(dot(rel, uAxisU), dot(rel, uAxisV)) / uScale;
  vec2 fuv = uFaceCentre + f / uExtent;

  vec2 d = vec2(0.0);
  if (uHasFace > 0.5 && !outside(fuv)) {
    d = dispAt(f);

    // The eyes keep their shape while the surface around them is pulled, and
    // are carried along by it. Which fragments that applies to is decided by
    // where the surface they show comes FROM, not by where they sit: judging
    // it by the fragment's own position leaves a rigid patch behind at the
    // undeformed eye position once the displacement exceeds the eye's size.
    if (uProtectEyes > 0.5 && uEyeRigid > 0.0) {
      vec2 content = f + d;
      vec2 socket = length(content - uEyeA) < length(content - uEyeB) ? uEyeA : uEyeB;
      vec2 rel = (content - socket) / (uEyeR * uEyeDeformScale);
      if (dot(rel, rel) < 9.0) {
        vec2 rigid = rigidAround(socket);
        float guard = eyeGuard(f + rigid, uEyeDeformScale, uEyeDeformSoft, uEyeDeformRound);
        d = mix(mix(d, rigid, uEyeRigid), d, guard);
      }
    }
  }
  vec2 fuv2 = fuv + d / uExtent;

  // The same displacement, expressed back in screen space, so the camera
  // image is dragged along with the marks sitting on it.
  vec2 sOff = (d.x * uAxisU + d.y * uAxisV) * uScale;
  vec2 camUv = clamp(vUv + vec2(sOff.x / uAspect, sOff.y), vec2(0.0), vec2(1.0));

  // The camera texture is unmirrored; everything else is in display space.
  vec2 texUv = vec2(1.0 - camUv.x, camUv.y);

  vec3 cam = texture(uVideo, texUv).rgb;
  // Luminance still drives the lighting and the eye grading; colour is only
  // what gets shown.
  float g = clamp((dot(cam, vec3(0.299, 0.587, 0.114)) - 0.5) * uContrast + 0.5 + uBright, 0.0, 1.0);
  vec3 tone = clamp((cam - 0.5) * uContrast + 0.5 + uBright, 0.0, 1.0);
  vec3 look = mix(vec3(g), tone, uColour);
  float person = uHasMask > 0.5 ? texture(uMask, texUv).r : 1.0;

  // ---- the surface the paint is lying on ----------------------------------
  // Fine detail comes from the picture, but the shape of the head comes from
  // the landmark depth map. Only the second survives flat frontal lighting,
  // which is exactly the case where the coat used to go dead flat.
  float k = uPixel * 5.0;
  float lx = lumAt(camUv + vec2(k, 0.0)) - lumAt(camUv - vec2(k, 0.0));
  float ly = lumAt(camUv + vec2(0.0, k)) - lumAt(camUv - vec2(0.0, k));
  vec3 nForm = normalize(vec3(-lx * uFormRelief, -ly * uFormRelief, 1.0));

  vec3 nGeo = nForm;
  if (uHasDepth > 0.5 && !outside(fuv2)) {
    vec4 dep = texture(uDepth, fuv2);
    vec2 slope = (dep.rg * 2.0 - 1.0) * uDepthRange;
    vec3 nHead = normalize(vec3(-slope.x * uFaceRelief, -slope.y * uFaceRelief, 1.0));
    nGeo = normalize(mix(nForm, normalize(mix(nHead, nForm, 0.22)), dep.b));
  }

  float sculpt = clamp(dot(nGeo, L), 0.0, 1.0);

  vec3 paper = uPaper + (hash(floor(gl_FragCoord.xy)) - 0.5) * 0.05;
  vec3 bust = paper * (0.12 + 0.88 * look);
  // Bare skin is modelled too, so the head reads as a head and not a cut-out.
  bust *= mix(1.0, 0.78 + 0.44 * sculpt, uSculpt);

  // The one thing that survives. Contrast is lifted around the eye so the
  // white and the iris separate, but in colour, with a soft falloff, and
  // only in proportion to how much paint has closed in around it. Applied
  // unconditionally it read as a dead patch stuck on an untouched face.
  vec2 fe = f + d;
  vec2 nearEye = length(fe - uEyeA) < length(fe - uEyeB) ? uEyeA : uEyeB;
  float grade = uHasFace * uEyeGrade * eyeGrade(fe) * smoothstep(0.12, 0.65, buried(nearEye));
  if (grade > 0.001) {
    vec3 punched = clamp((look - 0.5) * uEyePunch + 0.5 + uEyeLift, 0.0, 1.0);
    bust = mix(bust, paper * (0.10 + 0.90 * punched), grade);
  }

  vec3 base = mix(paper, bust, person);

  // ---- the coat -----------------------------------------------------------
  vec4 ink = vec4(0.0);
  float guardHere = eyeGuard(f + d, 1.0, uEyeSoft, 0.0);
  bool onCanvas = uHasFace > 0.5 && !outside(fuv2);
  if (onCanvas) ink = texture(uInk, fuv2);
  ink.a *= guardHere;

  // Paint belongs on the visitor. The mask is upscaled from a small one, so a
  // little sharpening makes it end at the silhouette rather than fade across it.
  float body = mix(1.0, smoothstep(0.35, 0.68, person), uBodyOnly);
  // Segmentation counts the visitor's hands as the visitor, so without this a
  // hand held up to the face wears the paint meant for the face. Cutting it
  // out also gives the hand the right behaviour: it hides the coat while it
  // is there, and what is underneath comes back when it moves.
  if (uHasHands > 0.5) body *= 1.0 - texture(uHandMask, camUv).a;
  ink.a *= body;

  // Stretched surface loses a little pigment, so the material reads as giving
  // way rather than the image simply sliding.
  float strain = clamp(length(d) / max(uDeform, 1e-4), 0.0, 1.0);
  base = mix(base, base * 0.88 + 0.06, strain * 0.5);

  // Paint sitting proud of the skin drops a shadow beside itself. This has to
  // be computed where there is no ink, which is exactly where it shows.
  if (onCanvas) {
    float occl = texture(uInk, fuv2 - L.xy * uInkTexel * 4.0).a * guardHere * body;
    base *= 1.0 - uPaintShadow * clamp(occl - ink.a, 0.0, 1.0);
  }

  vec3 col = base;
  if (ink.a > 0.003) {
    // The thickness gradient of the pool is its own surface normal. Sampling
    // a few texels out gives the wide bevel of a wet edge, not a crease.
    float t = uInkTexel * 3.0;
    float ax = texture(uInk, fuv2 + vec2(t, 0.0)).a - texture(uInk, fuv2 - vec2(t, 0.0)).a;
    float ay = texture(uInk, fuv2 + vec2(0.0, t)).a - texture(uInk, fuv2 - vec2(0.0, t)).a;
    vec3 nPaint = normalize(vec3(-ax * uPaintRelief, -ay * uPaintRelief, 1.0));

    // A coat is thin: it takes the shape of the head underneath, plus the
    // bevel of its own edge.
    vec3 n = normalize(mix(nGeo, nPaint, 0.45));
    float lambert = clamp(dot(n, L), 0.0, 1.0);
    float h = clamp(reflect(-L, n).z, 0.0, 1.0);
    // A glint over a broad sheen: the two together read as wet.
    float spec = pow(h, 38.0) * 1.35 + pow(h, 5.0) * 0.42;
    float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.2);

    // Thick, but never opaque: the nose and lips stay legible through it.
    vec3 pigment = ink.rgb * mix(1.0, 0.30 + 1.45 * g, uPaintForm);
    // Kept below clipping on purpose: a bright pigment pushed past 1.0 loses
    // its modelling entirely, and only the highlight should blow out.
    pigment *= 0.48 + 0.62 * lambert;
    pigment += ink.rgb * rim * 0.35;
    pigment *= 1.0 + (hash(floor(fuv2 * 1100.0)) - 0.5) * 0.09;
    pigment += vec3(spec) * uPaintGloss;

    col = mix(base, pigment, ink.a);
  }

  // The generating sweep: everything above the line has been brought into
  // being, everything below is still waiting.
  if (uScan >= 0.0) {
    float band = 1.0 - smoothstep(0.0, 0.035, abs(vUv.y - uScan));
    col = mix(col * 0.28, col, step(vUv.y, uScan + 0.02));
    col += band * 0.45;
  }

  frag = vec4(col * uReveal, 1.0);
}`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
      antialias: false,
      preserveDrawingBuffer: true,
      alpha: false,
    });
    if (!this.gl) throw new Error('WebGL2 is not available in this browser.');

    const gl = this.gl;
    this.program = link(gl, VERT, FRAG);
    gl.useProgram(this.program);

    this.u = {};
    for (const name of ['uVideo', 'uInk', 'uDisp', 'uMask', 'uAspect', 'uOrigin',
      'uAxisU', 'uAxisV', 'uScale', 'uExtent', 'uFaceCentre', 'uDeform', 'uHasFace',
      'uHasMask', 'uContrast', 'uBright', 'uPaper', 'uReveal', 'uScan',
      'uEyeA', 'uEyeB', 'uEyeR', 'uLidA', 'uLidB', 'uProtectEyes', 'uEyeSoft',
      'uEyeDeformSoft', 'uEyeDeformRound', 'uInkTexel', 'uPaintForm', 'uPaintRelief', 'uPaintGloss', 'uPaintShadow',
      'uFormRelief', 'uPixel', 'uBodyOnly',
      'uDepth', 'uHasDepth', 'uDepthRange', 'uFaceRelief', 'uSculpt',
      'uEyeRigid', 'uEyeDeformScale', 'uEyeGrade', 'uEyePunch', 'uEyeLift', 'uColour',
      'uEyeGradeFrom', 'uEyeGradeTo', 'uHandMask', 'uHasHands']) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }

    gl.uniform1i(this.u.uVideo, 0);
    gl.uniform1i(this.u.uInk, 1);
    gl.uniform1i(this.u.uDisp, 2);
    gl.uniform1i(this.u.uMask, 3);
    gl.uniform1i(this.u.uDepth, 4);
    gl.uniform1i(this.u.uHandMask, 5);
    gl.uniform1f(this.u.uExtent, CONFIG.faceExtent);
    gl.uniform2f(this.u.uFaceCentre, CONFIG.faceCentre.x, CONFIG.faceCentre.y);
    gl.uniform1f(this.u.uDeform, CONFIG.deformStrength);
    gl.uniform1f(this.u.uContrast, CONFIG.contrast);
    gl.uniform1f(this.u.uColour, CONFIG.bodyColour);
    gl.uniform1f(this.u.uBright, CONFIG.brightness);
    gl.uniform3f(this.u.uPaper, ...CONFIG.paper);
    gl.uniform1f(this.u.uProtectEyes, CONFIG.protectEyes ? 1 : 0);
    gl.uniform1f(this.u.uEyeSoft, CONFIG.eyeGuard.soft);
    gl.uniform1f(this.u.uEyeDeformSoft, CONFIG.eyeGuard.deformSoft);
    gl.uniform1f(this.u.uEyeDeformRound, CONFIG.eyeGuard.deformRound);
    gl.uniform1f(this.u.uEyeRigid, CONFIG.eyeGuard.rigid);
    gl.uniform1f(this.u.uEyeDeformScale, CONFIG.eyeGuard.deformScale);
    gl.uniform1f(this.u.uEyeGrade, CONFIG.eyeGuard.grade);
    gl.uniform1f(this.u.uEyePunch, CONFIG.eyeGuard.punch);
    gl.uniform1f(this.u.uEyeLift, CONFIG.eyeGuard.lift);
    gl.uniform1f(this.u.uEyeGradeFrom, CONFIG.eyeGuard.gradeFrom);
    gl.uniform1f(this.u.uEyeGradeTo, CONFIG.eyeGuard.gradeTo);
    gl.uniform1f(this.u.uInkTexel, 1 / CONFIG.inkSize);
    gl.uniform1f(this.u.uPaintForm, CONFIG.paint.form);
    gl.uniform1f(this.u.uPaintRelief, CONFIG.paint.relief);
    gl.uniform1f(this.u.uPaintGloss, CONFIG.paint.gloss);
    gl.uniform1f(this.u.uPaintShadow, CONFIG.paint.shadow);
    gl.uniform1f(this.u.uFormRelief, CONFIG.paint.formRelief);
    gl.uniform1f(this.u.uBodyOnly, CONFIG.inkOnBodyOnly ? 1 : 0);
    gl.uniform1f(this.u.uDepthRange, CONFIG.depthRange);
    gl.uniform1f(this.u.uFaceRelief, CONFIG.paint.faceRelief);
    gl.uniform1f(this.u.uSculpt, CONFIG.paint.sculpt);

    this.vao = gl.createVertexArray();
    this.texVideo = texture(gl);
    this.texInk = texture(gl);
    this.texDisp = texture(gl);
    this.texMask = texture(gl);
    this.texDepth = texture(gl);
    this.texHands = texture(gl);
    this.hasMask = false;
    this.hasDepth = false;
    this.hasHands = false;
    this.reveal = 1;
    this.scan = -1;
  }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.useProgram(this.program);
    this.gl.uniform1f(this.u.uAspect, width / height);
    this.gl.uniform1f(this.u.uPixel, 1 / height);
  }

  updateVideo(video) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texVideo);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  }

  updateInk(canvas) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texInk);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  updateDisp(bytes, size) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.texDisp);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, size, size, 0, gl.RG, gl.UNSIGNED_BYTE, bytes);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  updateMask(data, width, height) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.texMask);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.hasMask = true;
  }

  updateDepth(bytes, size) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.texDepth);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    this.hasDepth = true;
  }

  updateHandMask(canvas, active) {
    this.hasHands = active;
    if (!active) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.texHands);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  render(face) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    gl.uniform1f(this.u.uHasFace, face?.present ? 1 : 0);
    if (face?.present) {
      gl.uniform2f(this.u.uOrigin, face.origin.x, face.origin.y);
      gl.uniform2f(this.u.uAxisU, face.axisU.x, face.axisU.y);
      gl.uniform2f(this.u.uAxisV, face.axisV.x, face.axisV.y);
      gl.uniform1f(this.u.uScale, face.scale);
      gl.uniform2f(this.u.uEyeA, face.eyes.a.x, face.eyes.a.y);
      gl.uniform2f(this.u.uEyeB, face.eyes.b.x, face.eyes.b.y);
      gl.uniform2f(this.u.uEyeR, face.eyes.rx, face.eyes.ry);
      gl.uniform1fv(this.u.uLidA, face.eyes.lids[0]);
      gl.uniform1fv(this.u.uLidB, face.eyes.lids[1]);
    }
    gl.uniform1f(this.u.uHasMask, this.hasMask ? 1 : 0);
    gl.uniform1f(this.u.uHasDepth, this.hasDepth ? 1 : 0);
    gl.uniform1f(this.u.uHasHands, this.hasHands ? 1 : 0);
    gl.uniform1f(this.u.uReveal, this.reveal);
    gl.uniform1f(this.u.uScan, this.scan);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texVideo);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texInk);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.texDisp);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.texMask);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.texDepth);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.texHands);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

function texture(gl) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // One opaque pixel, so every sampler is complete before the first upload.
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 0]));
  return t;
}

function link(gl, vs, fs) {
  const program = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`shader: ${gl.getShaderInfoLog(shader)}`);
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`link: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}
