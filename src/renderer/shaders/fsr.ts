// Portions of EASU/RCAS from AMD FidelityFX FSR 1.0 (MIT):
// Copyright (c) 2021 Advanced Micro Devices, Inc. All rights reserved.

export const easuVertexSource = `#version 300 es
void main() {
    vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const easuFragmentSource = `#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform vec2 u_inputSize;
uniform vec2 u_outputSize;

out vec4 fragColor;

vec3 FsrEasuLoad(ivec2 p) {
    ivec2 sz = textureSize(u_image, 0);
    p = clamp(p, ivec2(0), sz - ivec2(1));
    return texelFetch(u_image, p, 0).rgb;
}

void FsrEasuTap(
    inout vec3 aC,
    inout float aW,
    vec2 off,
    vec2 dir,
    vec2 len,
    float lob,
    float clp,
    vec3 c
) {
    vec2 v;
    v.x = off.x * dir.x + off.y * dir.y;
    v.y = off.x * (-dir.y) + off.y * dir.x;
    v *= len;
    float d2 = min(dot(v, v), clp);
    float wB = (2.0 / 5.0) * d2 - 1.0;
    float wA = lob * d2 - 1.0;
    wB *= wB;
    wA *= wA;
    wB = (25.0 / 16.0) * wB - (25.0 / 16.0 - 1.0);
    float w = wB * wA;
    aC += c * w;
    aW += w;
}

void FsrEasuSet(
    inout vec2 dir,
    inout float len,
    float w,
    float lA,
    float lB,
    float lC,
    float lD,
    float lE
) {
    float dc = lD - lC;
    float cb = lC - lB;
    float lenX = max(abs(dc), abs(cb));
    lenX = 1.0 / max(lenX, 1.0 / 32768.0);
    float dirX = lD - lB;
    dir.x += dirX * w;
    lenX = clamp(abs(dirX) * lenX, 0.0, 1.0);
    lenX *= lenX;
    len += lenX * w;

    float ec = lE - lC;
    float ca = lC - lA;
    float lenY = max(abs(ec), abs(ca));
    lenY = 1.0 / max(lenY, 1.0 / 32768.0);
    float dirY = lE - lA;
    dir.y += dirY * w;
    lenY = clamp(abs(dirY) * lenY, 0.0, 1.0);
    lenY *= lenY;
    len += lenY * w;
}

vec3 FsrEasuF(vec2 ip) {
    vec2 scale = u_inputSize / u_outputSize;
    vec2 pp = ip * scale + (0.5 * scale - 0.5);
    vec2 fp = floor(pp);
    pp -= fp;
    ivec2 ifp = ivec2(fp);

    vec3 b = FsrEasuLoad(ifp + ivec2(0, -1));
    vec3 c = FsrEasuLoad(ifp + ivec2(1, -1));
    vec3 e = FsrEasuLoad(ifp + ivec2(-1, 0));
    vec3 f = FsrEasuLoad(ifp + ivec2(0, 0));
    vec3 g = FsrEasuLoad(ifp + ivec2(1, 0));
    vec3 h = FsrEasuLoad(ifp + ivec2(2, 0));
    vec3 i = FsrEasuLoad(ifp + ivec2(-1, 1));
    vec3 j = FsrEasuLoad(ifp + ivec2(0, 1));
    vec3 k = FsrEasuLoad(ifp + ivec2(1, 1));
    vec3 l = FsrEasuLoad(ifp + ivec2(2, 1));
    vec3 n = FsrEasuLoad(ifp + ivec2(0, 2));
    vec3 o = FsrEasuLoad(ifp + ivec2(1, 2));

    float bL = b.b * 0.5 + (b.r * 0.5 + b.g);
    float cL = c.b * 0.5 + (c.r * 0.5 + c.g);
    float eL = e.b * 0.5 + (e.r * 0.5 + e.g);
    float fL = f.b * 0.5 + (f.r * 0.5 + f.g);
    float gL = g.b * 0.5 + (g.r * 0.5 + g.g);
    float hL = h.b * 0.5 + (h.r * 0.5 + h.g);
    float iL = i.b * 0.5 + (i.r * 0.5 + i.g);
    float jL = j.b * 0.5 + (j.r * 0.5 + j.g);
    float kL = k.b * 0.5 + (k.r * 0.5 + k.g);
    float lL = l.b * 0.5 + (l.r * 0.5 + l.g);
    float nL = n.b * 0.5 + (n.r * 0.5 + n.g);
    float oL = o.b * 0.5 + (o.r * 0.5 + o.g);

    vec2 dir = vec2(0.0);
    float len = 0.0;
    FsrEasuSet(dir, len, (1.0 - pp.x) * (1.0 - pp.y), bL, eL, fL, gL, jL);
    FsrEasuSet(dir, len, pp.x * (1.0 - pp.y), cL, fL, gL, hL, kL);
    FsrEasuSet(dir, len, (1.0 - pp.x) * pp.y, fL, iL, jL, kL, nL);
    FsrEasuSet(dir, len, pp.x * pp.y, gL, jL, kL, lL, oL);

    vec2 dir2 = dir * dir;
    float dirR = dir2.x + dir2.y;
    bool zro = dirR < (1.0 / 32768.0);
    dirR = inversesqrt(max(dirR, 1.0 / 32768.0));
    dirR = zro ? 1.0 : dirR;
    dir.x = zro ? 1.0 : dir.x;
    dir *= dirR;

    len = len * 0.5;
    len *= len;
    float stretch = (dir.x * dir.x + dir.y * dir.y) * (1.0 / max(max(abs(dir.x), abs(dir.y)), 1.0 / 32768.0));
    vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
    float lob = 0.5 + ((1.0 / 4.0 - 0.04) - 0.5) * len;
    float clp = 1.0 / lob;

    vec3 min4 = min(min(min(f, g), j), k);
    vec3 max4 = max(max(max(f, g), j), k);
    vec3 aC = vec3(0.0);
    float aW = 0.0;
    FsrEasuTap(aC, aW, vec2(0.0, -1.0) - pp, dir, len2, lob, clp, b);
    FsrEasuTap(aC, aW, vec2(1.0, -1.0) - pp, dir, len2, lob, clp, c);
    FsrEasuTap(aC, aW, vec2(-1.0, 1.0) - pp, dir, len2, lob, clp, i);
    FsrEasuTap(aC, aW, vec2(0.0, 1.0) - pp, dir, len2, lob, clp, j);
    FsrEasuTap(aC, aW, vec2(0.0, 0.0) - pp, dir, len2, lob, clp, f);
    FsrEasuTap(aC, aW, vec2(-1.0, 0.0) - pp, dir, len2, lob, clp, e);
    FsrEasuTap(aC, aW, vec2(1.0, 1.0) - pp, dir, len2, lob, clp, k);
    FsrEasuTap(aC, aW, vec2(2.0, 1.0) - pp, dir, len2, lob, clp, l);
    FsrEasuTap(aC, aW, vec2(2.0, 0.0) - pp, dir, len2, lob, clp, h);
    FsrEasuTap(aC, aW, vec2(1.0, 0.0) - pp, dir, len2, lob, clp, g);
    FsrEasuTap(aC, aW, vec2(1.0, 2.0) - pp, dir, len2, lob, clp, o);
    FsrEasuTap(aC, aW, vec2(0.0, 2.0) - pp, dir, len2, lob, clp, n);

    return min(max4, max(min4, aC / max(aW, 1.0 / 32768.0)));
}

void main() {
    vec3 pix = FsrEasuF(floor(gl_FragCoord.xy));
    fragColor = vec4(clamp(pix, 0.0, 1.0), 1.0);
}
`;

export const rcasColorVertexSource = `#version 300 es
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

export const rcasColorFragmentSource = `#version 300 es
precision highp float;

in vec2 v_texCoord;
uniform sampler2D u_image;
uniform vec2 u_textureSize;

uniform float u_sharpen;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_saturation;
uniform float u_hue;
uniform float u_gamma;
uniform float u_opacity;

out vec4 fragColor;

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

vec3 FsrRcas(vec2 uv, float sharp, out float alpha) {
    vec2 texel = 1.0 / u_textureSize;
    vec4 ee = texture(u_image, uv);
    alpha = ee.a;
    vec3 e = ee.rgb;
    if (sharp <= 0.0) {
        return e;
    }

    vec3 b = texture(u_image, uv + vec2(0.0, -texel.y)).rgb;
    vec3 d = texture(u_image, uv + vec2(-texel.x, 0.0)).rgb;
    vec3 f = texture(u_image, uv + vec2(texel.x, 0.0)).rgb;
    vec3 h = texture(u_image, uv + vec2(0.0, texel.y)).rgb;

    float mn4R = min(min(min(b.r, d.r), f.r), h.r);
    float mn4G = min(min(min(b.g, d.g), f.g), h.g);
    float mn4B = min(min(min(b.b, d.b), f.b), h.b);
    float mx4R = max(max(max(b.r, d.r), f.r), h.r);
    float mx4G = max(max(max(b.g, d.g), f.g), h.g);
    float mx4B = max(max(max(b.b, d.b), f.b), h.b);

    float hitMinR = min(mn4R, e.r) * (1.0 / max(4.0 * mx4R, 1.0e-20));
    float hitMinG = min(mn4G, e.g) * (1.0 / max(4.0 * mx4G, 1.0e-20));
    float hitMinB = min(mn4B, e.b) * (1.0 / max(4.0 * mx4B, 1.0e-20));
    float hitMaxR = (1.0 - max(mx4R, e.r)) * (1.0 / (4.0 * mn4R - 4.0));
    float hitMaxG = (1.0 - max(mx4G, e.g)) * (1.0 / (4.0 * mn4G - 4.0));
    float hitMaxB = (1.0 - max(mx4B, e.b)) * (1.0 / (4.0 * mn4B - 4.0));

    float lobeR = max(-hitMinR, hitMaxR);
    float lobeG = max(-hitMinG, hitMaxG);
    float lobeB = max(-hitMinB, hitMaxB);
    float lobe = max(-(0.25 - 1.0 / 16.0), min(max(max(lobeR, lobeG), lobeB), 0.0));
    lobe *= exp2(-(1.0 - sharp));

    float rcpL = 1.0 / (4.0 * lobe + 1.0);
    return vec3(
        (lobe * b.r + lobe * d.r + lobe * h.r + lobe * f.r + e.r) * rcpL,
        (lobe * b.g + lobe * d.g + lobe * h.g + lobe * f.g + e.g) * rcpL,
        (lobe * b.b + lobe * d.b + lobe * h.b + lobe * f.b + e.b) * rcpL
    );
}

void main() {
    float sharp = clamp(u_sharpen, 0.0, 1.0);
    float srcAlpha;
    vec3 rgb = clamp(FsrRcas(v_texCoord, sharp, srcAlpha), 0.0, 1.0);

    rgb += u_brightness;
    rgb = (rgb - 0.5) * u_contrast + 0.5;
    rgb = clamp(rgb, 0.0, 1.0);

    if (u_hue != 0.0 || u_saturation != 1.0) {
        vec3 hsv = rgb2hsv(rgb);
        hsv.x = fract(hsv.x + u_hue / 360.0);
        hsv.y = clamp(hsv.y * u_saturation, 0.0, 1.0);
        rgb = hsv2rgb(hsv);
    }

    if (u_gamma != 1.0) {
        rgb = pow(clamp(rgb, 0.0, 1.0), vec3(1.0 / max(u_gamma, 0.001)));
    }

    fragColor = vec4(rgb, srcAlpha * u_opacity);
}
`;
