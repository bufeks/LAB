import { CONFIG } from './config.js';

const VERT = `#version 300 es
out vec2 vUv;
void main() {
  // One oversized triangle covering the viewport.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 frag;

uniform sampler2D uPortrait;
uniform sampler2D uInk;
uniform sampler2D uDisp;
uniform float uStrength;
uniform float uReveal;

void main() {
  vec2 d = (texture(uDisp, vUv).rg * 2.0 - 1.0) * uStrength;
  vec2 uv = clamp(vUv + d, vec2(0.0), vec2(1.0));

  vec3 base = texture(uPortrait, uv).rgb;
  vec4 ink = texture(uInk, uv);

  // Stretching the surface thins the pigment slightly, which reads as the
  // material giving way rather than the image simply sliding.
  float strain = clamp(length(d) / max(uStrength, 0.0001), 0.0, 1.0);
  base = mix(base, base * 0.88 + 0.06, strain * 0.55);

  vec3 col = mix(base, ink.rgb, ink.a);
  col *= uReveal;
  frag = vec4(col, 1.0);
}`;

// Composites the three layers on the GPU: the still portrait, the ink on top
// of it, and the displacement field that bends both together.
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
    this.u = {
      portrait: gl.getUniformLocation(this.program, 'uPortrait'),
      ink: gl.getUniformLocation(this.program, 'uInk'),
      disp: gl.getUniformLocation(this.program, 'uDisp'),
      strength: gl.getUniformLocation(this.program, 'uStrength'),
      reveal: gl.getUniformLocation(this.program, 'uReveal'),
    };
    gl.uniform1i(this.u.portrait, 0);
    gl.uniform1i(this.u.ink, 1);
    gl.uniform1i(this.u.disp, 2);
    gl.uniform1f(this.u.strength, CONFIG.deformStrength);

    this.vao = gl.createVertexArray();
    this.texPortrait = texture(gl);
    this.texInk = texture(gl);
    this.texDisp = texture(gl);
    this.reveal = 1;
  }

  setPortrait(source) {
    const gl = this.gl;
    this.canvas.width = source.width;
    this.canvas.height = source.height;
    gl.bindTexture(gl.TEXTURE_2D, this.texPortrait);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  updateInk(canvas) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texInk);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  updateDisp(bytes, w, h) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texDisp);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, w, h, 0, gl.RG, gl.UNSIGNED_BYTE, bytes);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  render() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform1f(this.u.reveal, this.reveal);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texPortrait);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texInk);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.texDisp);
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
