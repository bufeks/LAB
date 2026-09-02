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
uniform float uContrast;
uniform float uBright;
uniform vec3 uPaper;
uniform float uReveal;
uniform float uScan;
uniform vec2 uEyeA;
uniform vec2 uEyeB;
uniform vec2 uEyeR;
uniform float uProtectEyes;
uniform float uEyeSoft;
uniform float uEyeDeform;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

bool outside(vec2 p) {
  return p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0;
}

// 1 well clear of the eyes, 0 inside one. Everything the visitor throws is
// multiplied by this, so the eyes stay open however wrecked the rest gets.
float eyeGuard(vec2 f) {
  if (uProtectEyes < 0.5) return 1.0;
  float a = length((f - uEyeA) / uEyeR);
  float b = length((f - uEyeB) / uEyeR);
  return smoothstep(uEyeSoft, 1.0, min(a, b));
}

void main() {
  // Aspect-corrected screen space: the same units the head frame is built in.
  vec2 s = vec2(vUv.x * uAspect, vUv.y);
  vec2 rel = s - uOrigin;
  vec2 f = vec2(dot(rel, uAxisU), dot(rel, uAxisV)) / uScale;
  vec2 fuv = uFaceCentre + f / uExtent;

  float guard = eyeGuard(f);

  vec2 d = vec2(0.0);
  if (uHasFace > 0.5 && !outside(fuv)) {
    d = (texture(uDisp, fuv).rg * 2.0 - 1.0) * uDeform;
  }
  // The eyes hold their shape while the surface around them is pulled.
  d *= mix(uEyeDeform, 1.0, guard);
  vec2 fuv2 = fuv + d / uExtent;

  // The same displacement, expressed back in screen space, so the camera
  // image is dragged along with the marks sitting on it.
  vec2 sOff = (d.x * uAxisU + d.y * uAxisV) * uScale;
  vec2 camUv = clamp(vUv + vec2(sOff.x / uAspect, sOff.y), vec2(0.0), vec2(1.0));

  // The camera texture is unmirrored; everything else is in display space.
  vec2 texUv = vec2(1.0 - camUv.x, camUv.y);

  vec3 cam = texture(uVideo, texUv).rgb;
  float g = dot(cam, vec3(0.299, 0.587, 0.114));
  g = clamp((g - 0.5) * uContrast + 0.5 + uBright, 0.0, 1.0);

  float person = uHasMask > 0.5 ? texture(uMask, texUv).r : 1.0;

  vec3 paper = uPaper + (hash(floor(gl_FragCoord.xy)) - 0.5) * 0.05;
  // Graphite on paper rather than a flat grey photograph.
  vec3 bust = paper * (0.12 + 0.88 * g);
  vec3 base = mix(paper, bust, person);

  vec4 ink = vec4(0.0);
  if (uHasFace > 0.5 && !outside(fuv2)) ink = texture(uInk, fuv2);
  // Judged at the coordinate actually on screen here, so the guard travels
  // with the surface when it is dragged.
  ink.a *= eyeGuard(f + d);

  // Stretched surface loses a little pigment, so the material reads as giving
  // way rather than the image simply sliding.
  float strain = clamp(length(d) / max(uDeform, 1e-4), 0.0, 1.0);
  base = mix(base, base * 0.88 + 0.06, strain * 0.5);

  vec3 col = mix(base, ink.rgb, ink.a);

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
      'uEyeA', 'uEyeB', 'uEyeR', 'uProtectEyes', 'uEyeSoft', 'uEyeDeform']) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }

    gl.uniform1i(this.u.uVideo, 0);
    gl.uniform1i(this.u.uInk, 1);
    gl.uniform1i(this.u.uDisp, 2);
    gl.uniform1i(this.u.uMask, 3);
    gl.uniform1f(this.u.uExtent, CONFIG.faceExtent);
    gl.uniform2f(this.u.uFaceCentre, CONFIG.faceCentre.x, CONFIG.faceCentre.y);
    gl.uniform1f(this.u.uDeform, CONFIG.deformStrength);
    gl.uniform1f(this.u.uContrast, CONFIG.contrast);
    gl.uniform1f(this.u.uBright, CONFIG.brightness);
    gl.uniform3f(this.u.uPaper, ...CONFIG.paper);
    gl.uniform1f(this.u.uProtectEyes, CONFIG.protectEyes ? 1 : 0);
    gl.uniform1f(this.u.uEyeSoft, CONFIG.eyeGuard.soft);
    gl.uniform1f(this.u.uEyeDeform, CONFIG.eyeGuard.deform);

    this.vao = gl.createVertexArray();
    this.texVideo = texture(gl);
    this.texInk = texture(gl);
    this.texDisp = texture(gl);
    this.texMask = texture(gl);
    this.hasMask = false;
    this.reveal = 1;
    this.scan = -1;
  }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.useProgram(this.program);
    this.gl.uniform1f(this.u.uAspect, width / height);
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
    }
    gl.uniform1f(this.u.uHasMask, this.hasMask ? 1 : 0);
    gl.uniform1f(this.u.uReveal, this.reveal);
    gl.uniform1f(this.u.uScan, this.scan);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texVideo);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texInk);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.texDisp);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.texMask);
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
