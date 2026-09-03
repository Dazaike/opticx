// rife_v4.25_lite_v2 takes a single [1, 7, H, W] input:
// planes 0-2 = img0 RGB, planes 3-5 = img1 RGB, plane 6 = timestep.
struct Params {
  src_w: u32,
  src_h: u32,
  dst_w: u32,
  dst_h: u32,
  timestep: f32,
}

@group(0) @binding(0) var src0: texture_2d<f32>;
@group(0) @binding(1) var src1: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;
@group(0) @binding(3) var<uniform> pack_params: Params;

@compute @workgroup_size(8, 8, 1)
fn pack(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= pack_params.dst_w || y >= pack_params.dst_h) {
    return;
  }

  let sx = min(x, pack_params.src_w - 1u);
  let sy = min(y, pack_params.src_h - 1u);
  let p0 = textureLoad(src0, vec2<i32>(i32(sx), i32(sy)), 0);
  let p1 = textureLoad(src1, vec2<i32>(i32(sx), i32(sy)), 0);

  let plane = pack_params.dst_w * pack_params.dst_h;
  let idx = y * pack_params.dst_w + x;
  dst[idx] = p0.r;
  dst[plane + idx] = p0.g;
  dst[plane * 2u + idx] = p0.b;
  dst[plane * 3u + idx] = p1.r;
  dst[plane * 4u + idx] = p1.g;
  dst[plane * 5u + idx] = p1.b;
  dst[plane * 6u + idx] = pack_params.timestep;
}

@group(0) @binding(0) var<storage, read> unpack_src: array<f32>;
@group(0) @binding(1) var<storage, read_write> unpack_dst: array<u32>;
@group(0) @binding(2) var<uniform> unpack_params: Params;

fn pack_rgba8(r: f32, g: f32, b: f32) -> u32 {
  let ru = u32(clamp(r, 0.0, 1.0) * 255.0 + 0.5);
  let gu = u32(clamp(g, 0.0, 1.0) * 255.0 + 0.5);
  let bu = u32(clamp(b, 0.0, 1.0) * 255.0 + 0.5);
  return ru | (gu << 8u) | (bu << 16u) | (255u << 24u);
}

@compute @workgroup_size(8, 8, 1)
fn unpack(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  if (x >= unpack_params.dst_w || y >= unpack_params.dst_h) {
    return;
  }

  let plane = unpack_params.src_w * unpack_params.src_h;
  let idx = y * unpack_params.src_w + x;
  let r = unpack_src[idx];
  let g = unpack_src[plane + idx];
  let b = unpack_src[plane * 2u + idx];
  unpack_dst[y * unpack_params.dst_w + x] = pack_rgba8(r, g, b);
}
