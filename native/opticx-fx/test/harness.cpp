#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include "fx-engine.h"

#include <windows.h>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace {

void FillTestImage(uint8_t* rgba, int width, int height) {
  for (int y = 0; y < height; ++y) {
    for (int x = 0; x < width; ++x) {
      uint8_t r = static_cast<uint8_t>((x * 255) / (width - 1));
      uint8_t g = static_cast<uint8_t>((y * 255) / (height - 1));
      uint8_t b = static_cast<uint8_t>(((x + y) * 255) / (width + height - 2));
      const int cx = x / 32;
      const int cy = y / 32;
      if (((cx + cy) & 1) != 0) {
        r = static_cast<uint8_t>(r / 2 + 80);
        g = static_cast<uint8_t>(g / 2 + 40);
      }
      if (x >= 180 && x <= 420 && y >= 140 && y <= 380) {
        const bool border = x < 188 || x > 412 || y < 148 || y > 372;
        r = border ? 0 : 255;
        g = border ? 0 : 255;
        b = border ? 0 : 255;
      }
      if (x == width / 2 || y == height / 2) {
        r = 0;
        g = 0;
        b = 0;
      }
      uint8_t* p = rgba + (static_cast<size_t>(y) * width + x) * 4;
      p[0] = r;
      p[1] = g;
      p[2] = b;
      p[3] = 255;
    }
  }
}

bool WritePpm(const char* path, const uint8_t* rgba, int width, int height) {
  FILE* f = nullptr;
  if (fopen_s(&f, path, "wb") != 0 || !f) return false;
  std::fprintf(f, "P6\n%d %d\n255\n", width, height);
  std::vector<uint8_t> rgb(static_cast<size_t>(width) * height * 3);
  for (int i = 0; i < width * height; ++i) {
    rgb[static_cast<size_t>(i) * 3 + 0] = rgba[static_cast<size_t>(i) * 4 + 0];
    rgb[static_cast<size_t>(i) * 3 + 1] = rgba[static_cast<size_t>(i) * 4 + 1];
    rgb[static_cast<size_t>(i) * 3 + 2] = rgba[static_cast<size_t>(i) * 4 + 2];
  }
  std::fwrite(rgb.data(), 1, rgb.size(), f);
  std::fclose(f);
  return true;
}

bool WriteSlotPpm(ShmRing& shm, int slot, const char* path) {
  ShmSlotView view{};
  char error[128];
  if (!shm.OutputSlot(slot, &view, error, sizeof(error))) return false;
  return WritePpm(path, view.pixels, static_cast<int>(*view.width), static_cast<int>(*view.height));
}

void PrintResult(const char* label, const FxResult& r, int inW, int inH) {
  if (r.ok) {
    std::printf("%s %dx%d -> %dx%d: %.2f ms\n", label, inW, inH, r.width, r.height, r.ms);
  } else {
    std::printf("%s %dx%d: %s (%d)\n", label, inW, inH, r.error ? r.error : "error", r.errorCode);
  }
}

bool HarnessOutDir(char* outDir, size_t cap) {
  wchar_t exe[MAX_PATH];
  if (GetModuleFileNameW(nullptr, exe, MAX_PATH) == 0) return false;
  wchar_t* slash = wcsrchr(exe, L'\\');
  if (slash) *slash = 0;
  slash = wcsrchr(exe, L'\\');
  if (slash && _wcsicmp(slash + 1, L"Release") == 0) *slash = 0;
  wcscat_s(exe, L"\\harness-out");
  CreateDirectoryW(exe, nullptr);
  return WideCharToMultiByte(CP_UTF8, 0, exe, -1, outDir, static_cast<int>(cap), nullptr, nullptr) > 0;
}

}  // namespace

int main() {
  char error[512];
  ShmRing shm;
  if (!shm.Open(error, sizeof(error))) {
    std::fprintf(stderr, "open shm: %s\n", error);
    return 1;
  }

  char outDir[MAX_PATH];
  if (!HarnessOutDir(outDir, sizeof(outDir))) {
    std::fprintf(stderr, "could not create harness-out\n");
    return 1;
  }

  FxEngine engine;

  FxResult cuda = engine.InitCuda();
  if (!cuda.ok) {
    if (cuda.errorCode == NVCV_ERR_LIBRARY) {
      FxRuntimeNotFoundMessage(error, sizeof(error));
      std::fprintf(stderr, "%s\n", error);
    } else {
      std::fprintf(stderr, "initCuda: %s\n", cuda.error ? cuda.error : "failed");
    }
    return 1;
  }


  constexpr int kW = 1920;
  constexpr int kH = 1080;
  std::vector<uint8_t> image(static_cast<size_t>(kW) * kH * 4);
  FillTestImage(image.data(), kW, kH);

  char inPath[MAX_PATH];
  std::snprintf(inPath, sizeof(inPath), "%s\\input-1920x1080.ppm", outDir);
  WritePpm(inPath, image.data(), kW, kH);

  auto run = [&](const char* label, const char* stage, const FxConfig& cfg, const char* file) {
    FxResult cfgR = engine.Configure(cfg);
    if (!cfgR.ok) {
      PrintResult(label, cfgR, kW, kH);
      return;
    }
    int slot = -1;
    if (!shm.WriteInput(image.data(), kW, kH, 0, &slot, error, sizeof(error))) {
      std::printf("%s writeInput: %s\n", label, error);
      return;
    }
    FxResult r = engine.Process(stage, shm, slot);
    PrintResult(label, r, kW, kH);
    if (r.ok) {
      char path[MAX_PATH];
      std::snprintf(path, sizeof(path), "%s\\%s", outDir, file);
      WriteSlotPpm(shm, slot, path);
    }
  };

  FxConfig ar;
  ar.artifactReductionEnabled = true;
  ar.artifactReductionMode = 0;
  run("AR", "ar-denoise", ar, "ar-1920x1080.ppm");

  FxConfig dn;
  dn.denoiseEnabled = true;
  dn.denoiseStrength = 0.f;
  run("Denoise", "ar-denoise", dn, "denoise-1920x1080.ppm");

  FxConfig sr;
  sr.superResEnabled = true;
  sr.superResScale = 2.f;
  sr.superResMode = 0;
  run("SuperRes 2x", "superres", sr, "superres-2x.ppm");

  FxConfig up;
  up.upscaleEnabled = true;
  up.upscaleScale = 2.f;
  up.upscaleStrength = 0.4f;
  run("Upscale 2x", "upscale", up, "upscale-2x.ppm");

  constexpr int k4kW = 3840;
  constexpr int k4kH = 2160;
  std::vector<uint8_t> image4k(static_cast<size_t>(k4kW) * k4kH * 4);
  FillTestImage(image4k.data(), k4kW, k4kH);
  FxResult cfg4k = engine.Configure(ar);
  if (!cfg4k.ok) {
    PrintResult("AR", cfg4k, k4kW, k4kH);
  } else {
    int slot = -1;
    if (!shm.WriteInput(image4k.data(), k4kW, k4kH, 0, &slot, error, sizeof(error))) {
      std::printf("AR 3840x2160 writeInput: %s\n", error);
    } else {
      FxResult r = engine.Process("ar-denoise", shm, slot);
      PrintResult("AR", r, k4kW, k4kH);
    }
  }

  engine.TeardownCuda();
  shm.Close();
  return 0;
}
