import { vertexShaderSource, fragmentShaderSource } from './shaders';
import { FilterSettings, TransformSettings } from '../shared/types';

export class WebGLRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private texCoordBuffer: WebGLBuffer | null = null;
  private videoTexture: WebGLTexture | null = null;
  private lastMatrix: Float32Array = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  private broadcastFbo: WebGLFramebuffer | null = null;
  private broadcastTexture: WebGLTexture | null = null;
  private readonly broadcastWidth = 3840;
  private readonly broadcastHeight = 2160;

  readonly frameSource: { texture: WebGLTexture | null; width: number; height: number } = {
    texture: null,
    width: 0,
    height: 0
  };

  private uMatrixLoc: WebGLUniformLocation | null = null;
  private uTextureSizeLoc: WebGLUniformLocation | null = null;
  private uSharpenLoc: WebGLUniformLocation | null = null;
  private uBrightnessLoc: WebGLUniformLocation | null = null;
  private uContrastLoc: WebGLUniformLocation | null = null;
  private uSaturationLoc: WebGLUniformLocation | null = null;
  private uHueLoc: WebGLUniformLocation | null = null;
  private uGammaLoc: WebGLUniformLocation | null = null;
  private uOpacityLoc: WebGLUniformLocation | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true
    });

    if (!gl) {
      throw new Error('WebGL2 is not supported on this browser/GPU');
    }
    this.gl = gl;
    this.initGL();
  }

  private createShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) throw new Error('Failed to create shader');
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error(`Shader compile error: ${info}`);
    }
    return shader;
  }

  private initGL(): void {
    const gl = this.gl;
    const vShader = this.createShader(gl.VERTEX_SHADER, vertexShaderSource);
    const fShader = this.createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);

    const program = gl.createProgram();
    if (!program) throw new Error('Failed to create WebGL program');
    gl.attachShader(program, vShader);
    gl.attachShader(program, fShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`);
    }
    this.program = program;

    const aPositionLoc = gl.getAttribLocation(program, 'a_position');
    const aTexCoordLoc = gl.getAttribLocation(program, 'a_texCoord');

    this.uMatrixLoc = gl.getUniformLocation(program, 'u_matrix');
    this.uTextureSizeLoc = gl.getUniformLocation(program, 'u_textureSize');
    this.uSharpenLoc = gl.getUniformLocation(program, 'u_sharpen');
    this.uBrightnessLoc = gl.getUniformLocation(program, 'u_brightness');
    this.uContrastLoc = gl.getUniformLocation(program, 'u_contrast');
    this.uSaturationLoc = gl.getUniformLocation(program, 'u_saturation');
    this.uHueLoc = gl.getUniformLocation(program, 'u_hue');
    this.uGammaLoc = gl.getUniformLocation(program, 'u_gamma');
    this.uOpacityLoc = gl.getUniformLocation(program, 'u_opacity');

    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    this.texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]),
      gl.STATIC_DRAW
    );

    this.videoTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.enableVertexAttribArray(aPositionLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.vertexAttribPointer(aPositionLoc, 2, gl.FLOAT, false, 0, 0);

    gl.enableVertexAttribArray(aTexCoordLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.vertexAttribPointer(aTexCoordLoc, 2, gl.FLOAT, false, 0, 0);
  }

  private multiply3(a: Float32Array, b: Float32Array): Float32Array {
    const r = new Float32Array(9);
    for (let col = 0; col < 3; col++) {
      for (let row = 0; row < 3; row++) {
        r[col * 3 + row] =
          a[row] * b[col * 3] + a[3 + row] * b[col * 3 + 1] + a[6 + row] * b[col * 3 + 2];
      }
    }
    return r;
  }

  /**
   * Rotate in pixel-proportional space so 90° (and arbitrary angles) keep the
   * source aspect instead of stretching in non-square NDC.
   */
  private computeTransformMatrix(
    transform: TransformSettings,
    canvasWidth: number,
    canvasHeight: number,
    inset: number
  ): Float32Array {
    const canvasAspect = canvasWidth / Math.max(canvasHeight, 1);
    const srcAspect =
      this.frameSource.width > 0 && this.frameSource.height > 0
        ? this.frameSource.width / this.frameSource.height
        : 16 / 9;

    const rad = (transform.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const userSx = transform.scaleX * (transform.flipH ? -1 : 1);
    const userSy = transform.scaleY * (transform.flipV ? -1 : 1);

    const hw = srcAspect;
    const hh = 1;
    const aabbW = Math.abs(cos) * hw + Math.abs(sin) * hh;
    const aabbH = Math.abs(sin) * hw + Math.abs(cos) * hh;

    let fitX = 1;
    let fitY = 1;
    if (transform.fitMode === 'cover') {
      const fit = Math.max(canvasAspect / aabbW, 1 / aabbH) * inset;
      fitX = fit;
      fitY = fit;
    } else if (transform.fitMode === 'stretch') {
      fitX = (canvasAspect / aabbW) * inset;
      fitY = (1 / aabbH) * inset;
    } else {
      const fit = Math.min(canvasAspect / aabbW, 1 / aabbH) * inset;
      fitX = fit;
      fitY = fit;
    }
    const toPixel = new Float32Array([srcAspect, 0, 0, 0, 1, 0, 0, 0, 1]);
    const user = new Float32Array([userSx, 0, 0, 0, userSy, 0, 0, 0, 1]);
    const rotation = new Float32Array([cos, sin, 0, -sin, cos, 0, 0, 0, 1]);
    const fit = new Float32Array([fitX, 0, 0, 0, fitY, 0, 0, 0, 1]);
    const toNdc = new Float32Array([1 / canvasAspect, 0, 0, 0, 1, 0, 0, 0, 1]);
    const translation = new Float32Array([
      1, 0, 0, 0, 1, 0, transform.offsetX, transform.offsetY, 1
    ]);

    return this.multiply3(
      translation,
      this.multiply3(toNdc, this.multiply3(fit, this.multiply3(rotation, this.multiply3(user, toPixel))))
    );
  }

  /** NDC corners of a camera quad under given or active transform, GL y-up. */
  getQuadNdc(transform?: TransformSettings, inset: number = 0.82): Array<{ x: number; y: number }> {
    const gl = this.gl;
    const w = gl.drawingBufferWidth || gl.canvas.width || 1280;
    const h = gl.drawingBufferHeight || gl.canvas.height || 720;
    const m = transform
      ? this.computeTransformMatrix(transform, w, h, inset)
      : this.lastMatrix;
    const src = [-1, -1, 1, -1, 1, 1, -1, 1];
    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < src.length; i += 2) {
      const x = src[i];
      const y = src[i + 1];
      points.push({
        x: m[0] * x + m[3] * y + m[6],
        y: m[1] * x + m[4] * y + m[7]
      });
    }
    return points;
  }

  /** NDC corners of the transformed camera quad, GL y-up. */
  getContentQuadNdc(): Array<{ x: number; y: number }> {
    return this.getQuadNdc();
  }

  /** NDC corners of the center-snapped camera quad (offsetX=0, offsetY=0), GL y-up. */
  getCenterQuadNdc(transform: TransformSettings, inset: number = 0.82): Array<{ x: number; y: number }> {
    return this.getQuadNdc({ ...transform, offsetX: 0, offsetY: 0 }, inset);
  }

  render(frame: VideoFrame, filters: FilterSettings, transform: TransformSettings): void {
    const gl = this.gl;
    if (!this.program || !this.videoTexture) return;

    gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    this.frameSource.texture = this.videoTexture;
    this.frameSource.width = frame.displayWidth;
    this.frameSource.height = frame.displayHeight;
    if (gl.drawingBufferWidth >= 2 && gl.drawingBufferHeight >= 2) {
      this.draw(filters, transform, gl.drawingBufferWidth, gl.drawingBufferHeight, null, 0.82);
    }
  }
  private ensureBroadcastTarget(): void {
    const gl = this.gl;
    if (this.broadcastFbo && this.broadcastTexture) return;

    const texture = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!texture || !fbo) throw new Error('Failed to allocate broadcast target');

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      this.broadcastWidth,
      this.broadcastHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.broadcastTexture = texture;
    this.broadcastFbo = fbo;
  }

  /**
   * Draws the processed camera into a 4K FBO. Leaves the preview backbuffer
   * untouched so the editor stays at display resolution while broadcasting.
   */
  renderBroadcast(filters: FilterSettings, transform: TransformSettings): WebGLTexture | null {
    if (!this.frameSource.texture) return null;
    this.ensureBroadcastTarget();
    this.draw(filters, transform, this.broadcastWidth, this.broadcastHeight, this.broadcastFbo, 1);
    return this.broadcastTexture;
  }

  redraw(filters: FilterSettings, transform: TransformSettings): void {
    if (!this.frameSource.texture) return;
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.frameSource.texture);
    this.draw(
      filters,
      transform,
      this.gl.drawingBufferWidth,
      this.gl.drawingBufferHeight,
      null,
      0.82
    );
  }

  clear(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.frameSource.texture = null;
    this.frameSource.width = 0;
    this.frameSource.height = 0;
  }

  private draw(
    filters: FilterSettings,
    transform: TransformSettings,
    viewportWidth: number,
    viewportHeight: number,
    framebuffer: WebGLFramebuffer | null,
    inset: number
  ): void {
    const gl = this.gl;
    if (!this.program) return;
    const { width, height } = this.frameSource;

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.useProgram(this.program);
    gl.viewport(0, 0, viewportWidth, viewportHeight);
    if (framebuffer) {
      gl.clearColor(0, 0, 0, 1);
    } else {
      gl.clearColor(0.28, 0.28, 0.28, 1);
    }
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.uniform2f(this.uTextureSizeLoc, width, height);
    gl.uniform1f(this.uSharpenLoc, filters.sharpen);
    gl.uniform1f(this.uBrightnessLoc, filters.brightness);
    gl.uniform1f(this.uContrastLoc, filters.contrast);
    gl.uniform1f(this.uSaturationLoc, filters.saturation);
    gl.uniform1f(this.uHueLoc, filters.hue);
    gl.uniform1f(this.uGammaLoc, filters.gamma);
    gl.uniform1f(this.uOpacityLoc, filters.opacity);

    const matrix = this.computeTransformMatrix(transform, viewportWidth, viewportHeight, inset);
    if (!framebuffer) this.lastMatrix.set(matrix);
    gl.uniformMatrix3fv(this.uMatrixLoc, false, matrix);
    gl.bindTexture(gl.TEXTURE_2D, this.frameSource.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (framebuffer) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  destroy(): void {
    if (this.videoTexture) this.gl.deleteTexture(this.videoTexture);
    if (this.broadcastTexture) this.gl.deleteTexture(this.broadcastTexture);
    if (this.broadcastFbo) this.gl.deleteFramebuffer(this.broadcastFbo);
    if (this.positionBuffer) this.gl.deleteBuffer(this.positionBuffer);
    if (this.texCoordBuffer) this.gl.deleteBuffer(this.texCoordBuffer);
    if (this.program) this.gl.deleteProgram(this.program);
  }
}
