/**
 * GPU RGBA -> NV12 converter for the OpticX Cam virtual camera.
 *
 * The shared producer frame is fixed at 3840x2160. DirectShow clients can
 * negotiate 4K or a smaller common capture resolution; the native filter
 * performs the final downscale and pixel-format conversion.
 *
 * Both passes pack 4 output bytes per RGBA8 texel so one `readPixels` per
 * plane yields tightly packed planar data. Framebuffer row zero is treated as
 * the top image row, matching NV12's top-down layout.
 */

export const NV12_WIDTH = 3840;
export const NV12_HEIGHT = 2160;
export const NV12_Y_BYTES = NV12_WIDTH * NV12_HEIGHT;
export const NV12_UV_BYTES = NV12_Y_BYTES / 2;
export const NV12_TOTAL_BYTES = NV12_Y_BYTES + NV12_UV_BYTES;

const Y_PASS_WIDTH = NV12_WIDTH / 4;
const Y_PASS_HEIGHT = NV12_HEIGHT;
const UV_PASS_WIDTH = NV12_WIDTH / 4;
const UV_PASS_HEIGHT = NV12_HEIGHT / 2;

const QUAD_VERTEX_SHADER = `#version 300 es
in vec2 a_position;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/**
 * Shared sampling helper: maps a destination pixel (top-left origin, 4K)
 * to the source rectangle and returns linear RGB, or black outside.
 */
const SAMPLE_CHUNK = `
uniform sampler2D u_source;
uniform vec2 u_scale;
uniform vec2 u_offset;
uniform float u_flipY;

vec3 sampleSource(vec2 dstPixel) {
    vec2 uv = (dstPixel / vec2(${NV12_WIDTH}.0, ${NV12_HEIGHT}.0) - u_offset) / u_scale;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        return vec3(0.0);
    }
    if (u_flipY > 0.5) uv.y = 1.0 - uv.y;
    return texture(u_source, uv).rgb;
}
`;

const Y_FRAGMENT_SHADER = `#version 300 es
precision highp float;
${SAMPLE_CHUNK}
out vec4 outColor;

// BT.601 limited range luma, normalised to the 8-bit target.
float lumaByte(vec3 rgb) {
    return (16.0 + 65.481 * rgb.r + 128.553 * rgb.g + 24.966 * rgb.b) / 255.0;
}

void main() {
    // Framebuffer row 0 holds image row 0 (top), so readPixels emits NV12 order.
    float row = floor(gl_FragCoord.y);
    float baseX = floor(gl_FragCoord.x) * 4.0;

    outColor = vec4(
        lumaByte(sampleSource(vec2(baseX + 0.5, row + 0.5))),
        lumaByte(sampleSource(vec2(baseX + 1.5, row + 0.5))),
        lumaByte(sampleSource(vec2(baseX + 2.5, row + 0.5))),
        lumaByte(sampleSource(vec2(baseX + 3.5, row + 0.5)))
    );
}
`;

const UV_FRAGMENT_SHADER = `#version 300 es
precision highp float;
${SAMPLE_CHUNK}
out vec4 outColor;

// BT.601 limited range chroma, normalised to the 8-bit target.
vec2 chromaBytes(vec3 rgb) {
    float u = 128.0 - 37.797 * rgb.r - 74.203 * rgb.g + 112.0 * rgb.b;
    float v = 128.0 + 112.0 * rgb.r - 93.786 * rgb.g - 18.214 * rgb.b;
    return vec2(u, v) / 255.0;
}

void main() {
    // Each texel covers two horizontally adjacent 2x2 luma blocks.
    float chromaRow = floor(gl_FragCoord.y);
    float chromaCol = floor(gl_FragCoord.x) * 2.0;

    // Centre of each 2x2 luma block: LINEAR filtering averages the four samples.
    float y = chromaRow * 2.0 + 1.0;
    vec2 uv0 = chromaBytes(sampleSource(vec2(chromaCol * 2.0 + 1.0, y)));
    vec2 uv1 = chromaBytes(sampleSource(vec2(chromaCol * 2.0 + 3.0, y)));

    outColor = vec4(uv0.x, uv0.y, uv1.x, uv1.y);
}
`;

interface EncodePass {
  program: WebGLProgram;
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
  sourceLoc: WebGLUniformLocation | null;
  scaleLoc: WebGLUniformLocation | null;
  offsetLoc: WebGLUniformLocation | null;
  flipYLoc: WebGLUniformLocation | null;
}

export class Nv12Encoder {
  private readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private readonly quadBuffer: WebGLBuffer;
  private readonly yPass: EncodePass;
  private readonly uvPass: EncodePass;
  private readonly inputTexture: WebGLTexture;
  private readonly yPbo: [WebGLBuffer, WebGLBuffer];
  private readonly uvPbo: [WebGLBuffer, WebGLBuffer];
  private pboIndex = 0;
  private pboPrimed = false;

  /** Single reusable output buffer: Y plane followed by interleaved UV plane. */
  private readonly output = new Uint8Array(NV12_TOTAL_BYTES);
  private readonly yPlane: Uint8Array;
  private readonly uvPlane: Uint8Array;
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.yPlane = this.output.subarray(0, NV12_Y_BYTES);
    this.uvPlane = this.output.subarray(NV12_Y_BYTES);

    const vao = gl.createVertexArray();
    const quadBuffer = gl.createBuffer();
    const inputTexture = gl.createTexture();
    const yPbo0 = gl.createBuffer();
    const yPbo1 = gl.createBuffer();
    const uvPbo0 = gl.createBuffer();
    const uvPbo1 = gl.createBuffer();
    if (!vao || !quadBuffer || !inputTexture || !yPbo0 || !yPbo1 || !uvPbo0 || !uvPbo1) {
      throw new Error('Failed to allocate NV12 encoder geometry or PBOs');
    }
    this.vao = vao;
    this.quadBuffer = quadBuffer;
    this.inputTexture = inputTexture;
    this.yPbo = [yPbo0, yPbo1];
    this.uvPbo = [uvPbo0, uvPbo1];

    for (let i = 0; i < 2; i++) {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.yPbo[i]);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, NV12_Y_BYTES, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.uvPbo[i]);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, NV12_UV_BYTES, gl.STREAM_READ);
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const previousVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.yPass = this.createPass(Y_FRAGMENT_SHADER, Y_PASS_WIDTH, Y_PASS_HEIGHT);
    this.uvPass = this.createPass(UV_FRAGMENT_SHADER, UV_PASS_WIDTH, UV_PASS_HEIGHT);

    gl.bindVertexArray(previousVao);
  }

  private compile(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Failed to create NV12 encoder shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`NV12 encoder shader compile error: ${info}`);
    }
    return shader;
  }

  private createPass(fragmentSource: string, width: number, height: number): EncodePass {
    const gl = this.gl;

    const vertexShader = this.compile(gl.VERTEX_SHADER, QUAD_VERTEX_SHADER);
    const fragmentShader = this.compile(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error('Failed to create NV12 encoder program');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`NV12 encoder program link error: ${gl.getProgramInfoLog(program)}`);
    }

    // The encoder owns its own VAO; the quad is bound for every pass program.
    const positionLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('Failed to allocate NV12 encoder target');

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`NV12 encoder framebuffer incomplete (status 0x${status.toString(16)})`);
    }

    return {
      program,
      framebuffer,
      texture,
      width,
      height,
      sourceLoc: gl.getUniformLocation(program, 'u_source'),
      scaleLoc: gl.getUniformLocation(program, 'u_scale'),
      offsetLoc: gl.getUniformLocation(program, 'u_offset'),
      flipYLoc: gl.getUniformLocation(program, 'u_flipY')
    };
  }

  private runPassToPbo(
    pass: EncodePass,
    sourceTexture: WebGLTexture,
    scaleX: number,
    scaleY: number,
    pbo: WebGLBuffer,
    flipY: boolean
  ): void {
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, pass.framebuffer);
    gl.viewport(0, 0, pass.width, pass.height);
    gl.useProgram(pass.program);
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.uniform1i(pass.sourceLoc, 0);
    gl.uniform2f(pass.scaleLoc, scaleX, scaleY);
    gl.uniform2f(pass.offsetLoc, (1 - scaleX) / 2, (1 - scaleY) / 2);
    gl.uniform1f(pass.flipYLoc, flipY ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.readPixels(0, 0, pass.width, pass.height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  }

  /**
   * Converts an already-resident RGBA texture into one 4K NV12 frame.
   * Uses double-buffered PBOs to avoid stalling the WebGL GPU pipeline.
   */
  encodeTexture(sourceTexture: WebGLTexture, srcWidth: number, srcHeight: number, flipY = true): Uint8Array {
    const gl = this.gl;
    if (srcWidth <= 0 || srcHeight <= 0) return this.output;

    const sourceAspect = srcWidth / srcHeight;
    const targetAspect = NV12_WIDTH / NV12_HEIGHT;
    const scaleX = sourceAspect > targetAspect ? 1 : sourceAspect / targetAspect;
    const scaleY = sourceAspect > targetAspect ? targetAspect / sourceAspect : 1;

    const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    const previousProgram = gl.getParameter(gl.CURRENT_PROGRAM);
    const previousVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    const previousActiveUnit = gl.getParameter(gl.ACTIVE_TEXTURE);
    gl.activeTexture(gl.TEXTURE0);
    const previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);

    const currentPbo = this.pboIndex;
    const prevPbo = 1 - currentPbo;

    gl.bindVertexArray(this.vao);
    this.runPassToPbo(this.yPass, sourceTexture, scaleX, scaleY, this.yPbo[currentPbo], flipY);
    this.runPassToPbo(this.uvPass, sourceTexture, scaleX, scaleY, this.uvPbo[currentPbo], flipY);

    if (!this.pboPrimed) {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.yPbo[currentPbo]);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.yPlane);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.uvPbo[currentPbo]);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.uvPlane);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.pboPrimed = true;
    } else {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.yPbo[prevPbo]);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.yPlane);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.uvPbo[prevPbo]);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.uvPlane);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    }
    this.pboIndex = prevPbo;

    gl.bindVertexArray(previousVao);
    gl.bindTexture(gl.TEXTURE_2D, previousTexture);
    gl.activeTexture(previousActiveUnit);
    gl.useProgram(previousProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

    return this.output;
  }

  /**
   * Uploads a 2D composition (preview + overlays) and converts it to 4K NV12.
   */
  encode(source: TexImageSource, srcWidth: number, srcHeight: number): Uint8Array {
    const gl = this.gl;
    if (srcWidth <= 0 || srcHeight <= 0) return this.output;

    gl.bindTexture(gl.TEXTURE_2D, this.inputTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return this.encodeTexture(this.inputTexture, srcWidth, srcHeight, false);
  }

  destroy(): void {
    const gl = this.gl;
    for (let i = 0; i < 2; i++) {
      gl.deleteBuffer(this.yPbo[i]);
      gl.deleteBuffer(this.uvPbo[i]);
    }
    for (const pass of [this.yPass, this.uvPass]) {
      gl.deleteFramebuffer(pass.framebuffer);
      gl.deleteTexture(pass.texture);
      gl.deleteProgram(pass.program);
    }
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteTexture(this.inputTexture);
    gl.deleteVertexArray(this.vao);
  }
}
