export const vertexShaderSource = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;

uniform mat3 u_matrix;

out vec2 v_texCoord;

void main() {
    // Apply affine transform matrix
    vec3 pos = u_matrix * vec3(a_position, 1.0);
    gl_Position = vec4(pos.xy, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
`;

export const fragmentShaderSource = `#version 300 es
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_image;
uniform vec2 u_textureSize;

// Filter Parameters
uniform float u_sharpen;      // 0.0 to 2.0 (default 0.0)
uniform float u_brightness;   // -1.0 to 1.0 (default 0.0)
uniform float u_contrast;     // 0.0 to 2.0 (default 1.0)
uniform float u_saturation;   // 0.0 to 2.0 (default 1.0)
uniform float u_hue;          // -180.0 to 180.0 (degrees)
uniform float u_gamma;        // 0.2 to 3.0 (default 1.0)
uniform float u_opacity;      // 0.0 to 1.0 (default 1.0)

out vec4 fragColor;

// RGB <-> HSV helpers
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 onePixel = vec2(1.0) / u_textureSize;

    // 1. Sharpening filter using 3x3 convolution
    vec4 colorCenter = texture(u_image, v_texCoord);
    vec4 colorTop    = texture(u_image, v_texCoord + vec2(0.0, -onePixel.y));
    vec4 colorBottom = texture(u_image, v_texCoord + vec2(0.0,  onePixel.y));
    vec4 colorLeft   = texture(u_image, v_texCoord + vec2(-onePixel.x, 0.0));
    vec4 colorRight  = texture(u_image, v_texCoord + vec2( onePixel.x, 0.0));

    // Laplacian kernel: [0, -1, 0; -1, 4, -1; 0, -1, 0]
    vec4 laplacian = 4.0 * colorCenter - (colorTop + colorBottom + colorLeft + colorRight);
    vec4 sharpened = colorCenter + u_sharpen * laplacian;
    vec3 rgb = clamp(sharpened.rgb, 0.0, 1.0);

    // 2. Brightness & Contrast
    rgb += u_brightness;
    rgb = (rgb - 0.5) * u_contrast + 0.5;
    rgb = clamp(rgb, 0.0, 1.0);

    // 3. Saturation & Hue Rotation
    if (u_hue != 0.0 || u_saturation != 1.0) {
        vec3 hsv = rgb2hsv(rgb);
        hsv.x = fract(hsv.x + u_hue / 360.0);
        hsv.y = clamp(hsv.y * u_saturation, 0.0, 1.0);
        rgb = hsv2rgb(hsv);
    }

    // 4. Gamma Correction
    if (u_gamma != 1.0) {
        rgb = pow(clamp(rgb, 0.0, 1.0), vec3(1.0 / max(u_gamma, 0.001)));
    }

    fragColor = vec4(rgb, colorCenter.a * u_opacity);
}
`;
