#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include "fx-engine.h"

#include "maxine-runtime.h"

#include <windows.h>

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>

namespace {

FxResult Fail(int code, const char* fallback = nullptr) {
  FxResult r;
  r.ok = false;
  r.errorCode = code;
  r.error = FxStatusName(code);
  if (r.error == nullptr) r.error = fallback ? fallback : "NVCV_ERR_GENERAL";
  return r;
}

FxResult OkResult(int width, int height, double ms) {
  FxResult r;
  r.ok = true;
  r.width = width;
  r.height = height;
  r.ms = ms;
  return r;
}

double NowMs() {
  static LARGE_INTEGER freq = {};
  if (freq.QuadPart == 0) QueryPerformanceFrequency(&freq);
  LARGE_INTEGER now;
  QueryPerformanceCounter(&now);
  return (1000.0 * static_cast<double>(now.QuadPart)) / static_cast<double>(freq.QuadPart);
}

void ZeroImage(NvCVImage* im) { std::memset(im, 0, sizeof(*im)); }

bool ModelDirFromRuntime(char* out, size_t cap) {
  const wchar_t* dir = MaxineRuntimeDirW();
  if (!dir || !dir[0]) return false;
  wchar_t wide[MAX_PATH];
  const int n = _snwprintf_s(wide, _TRUNCATE, L"%s\\models", dir);
  if (n <= 0) return false;
  const int bytes = WideCharToMultiByte(CP_UTF8, 0, wide, -1, out, static_cast<int>(cap), nullptr, nullptr);
  return bytes > 0;
}
NvCV_Status SetScale(NvVFX_Handle handle, float scale) {
  NvCV_Status err = NvVFX_SetF32(handle, NVVFX_SCALE, scale);
  if (err == NVCV_ERR_SELECTOR) {
    err = NvVFX_SetU32(handle, NVVFX_SCALE, static_cast<unsigned>(scale + 0.5f));
  }
  if (err == NVCV_ERR_SELECTOR) return NVCV_SUCCESS;
  return err;
}

NvCV_Status SetMode(NvVFX_Handle handle, unsigned mode) {
  NvCV_Status err = NvVFX_SetU32(handle, NVVFX_MODE, mode);
  if (err == NVCV_ERR_SELECTOR) {
    err = NvVFX_SetU32(handle, NVVFX_STRENGTH, mode);
  }
  return err;
}


}  // namespace

const char* FxStatusName(int code) {
  switch (code) {
    case NVCV_SUCCESS:
      return "NVCV_SUCCESS";
    case NVCV_ERR_GENERAL:
      return "NVCV_ERR_GENERAL";
    case NVCV_ERR_UNIMPLEMENTED:
      return "NVCV_ERR_UNIMPLEMENTED";
    case NVCV_ERR_MEMORY:
      return "NVCV_ERR_MEMORY";
    case NVCV_ERR_EFFECT:
      return "NVCV_ERR_EFFECT";
    case NVCV_ERR_SELECTOR:
      return "NVCV_ERR_SELECTOR";
    case NVCV_ERR_BUFFER:
      return "NVCV_ERR_BUFFER";
    case NVCV_ERR_PARAMETER:
      return "NVCV_ERR_PARAMETER";
    case NVCV_ERR_MISMATCH:
      return "NVCV_ERR_MISMATCH";
    case NVCV_ERR_PIXELFORMAT:
      return "NVCV_ERR_PIXELFORMAT";
    case NVCV_ERR_MODEL:
      return "NVCV_ERR_MODEL";
    case NVCV_ERR_LIBRARY:
      return "NVCV_ERR_LIBRARY";
    case NVCV_ERR_INITIALIZATION:
      return "NVCV_ERR_INITIALIZATION";
    case NVCV_ERR_FILE:
      return "NVCV_ERR_FILE";
    case NVCV_ERR_FEATURENOTFOUND:
      return "NVCV_ERR_FEATURENOTFOUND";
    case NVCV_ERR_MISSINGINPUT:
      return "NVCV_ERR_MISSINGINPUT";
    case NVCV_ERR_RESOLUTION:
      return "NVCV_ERR_RESOLUTION";
    case NVCV_ERR_UNSUPPORTEDGPU:
      return "NVCV_ERR_UNSUPPORTEDGPU";
    case NVCV_ERR_WRONGGPU:
      return "NVCV_ERR_WRONGGPU";
    case NVCV_ERR_UNSUPPORTEDDRIVER:
      return "NVCV_ERR_UNSUPPORTEDDRIVER";
    case NVCV_ERR_CUDA_MEMORY:
      return "NVCV_ERR_CUDA_MEMORY";
    case NVCV_ERR_CUDA_VALUE:
      return "NVCV_ERR_CUDA_VALUE";
    case NVCV_ERR_CUDA_PITCH:
      return "NVCV_ERR_CUDA_PITCH";
    case NVCV_ERR_CUDA_INIT:
      return "NVCV_ERR_CUDA_INIT";
    case NVCV_ERR_CUDA_LAUNCH:
      return "NVCV_ERR_CUDA_LAUNCH";
    case NVCV_ERR_CUDA_KERNEL:
      return "NVCV_ERR_CUDA_KERNEL";
    case NVCV_ERR_CUDA_DRIVER:
      return "NVCV_ERR_CUDA_DRIVER";
    case NVCV_ERR_CUDA_UNSUPPORTED:
      return "NVCV_ERR_CUDA_UNSUPPORTED";
    case NVCV_ERR_CUDA_ILLEGAL_ADDRESS:
      return "NVCV_ERR_CUDA_ILLEGAL_ADDRESS";
    case NVCV_ERR_CUDA:
      return "NVCV_ERR_CUDA";
    case NVCV_ERR_OBJECTNOTFOUND:
      return "NVCV_ERR_OBJECTNOTFOUND";
    default:
      return nullptr;
  }
}

void FxRuntimeNotFoundMessage(char* buf, size_t cap) {
  const wchar_t* dir = MaxineRuntimeDirW();
  char utf8[MAX_PATH * 2] = {};
  if (dir && dir[0]) {
    WideCharToMultiByte(CP_UTF8, 0, dir, -1, utf8, sizeof(utf8), nullptr, nullptr);
  } else {
    std::snprintf(utf8, sizeof(utf8), "C:\\Program Files\\NVIDIA Corporation\\NVIDIA Video Effects");
  }
  std::snprintf(buf, cap, "Maxine runtime not found at %s\\", utf8);
}

float FxEngine::CanonicalScale(float scale) const {
  if (scale > 1.2f && scale < 1.4f) return 4.f / 3.f;
  if (scale > 1.4f && scale < 1.7f) return 1.5f;
  if (scale > 1.7f && scale < 2.5f) return 2.f;
  if (scale > 2.5f && scale < 3.5f) return 3.f;
  if (scale > 3.5f && scale < 4.5f) return 4.f;
  return scale;
}

int FxEngine::ScaledDim(int value, float scale) const {
  return static_cast<int>(std::lround(static_cast<double>(value) * static_cast<double>(CanonicalScale(scale))));
}

NvCV_Status FxEngine::EnsureImage(NvCVImage* im, unsigned width, unsigned height, NvCVImage_PixelFormat format,
                                  NvCVImage_ComponentType type, unsigned layout, unsigned memSpace,
                                  unsigned alignment) {
  if (im->pixels && im->width == width && im->height == height && im->pixelFormat == format &&
      im->componentType == type && im->planar == layout && im->gpuMem == memSpace) {
    return NVCV_SUCCESS;
  }
  if (im->pixels) {
    return NvCVImage_Realloc(im, width, height, format, type, layout, memSpace, alignment);
  }
  return NvCVImage_Alloc(im, width, height, format, type, layout, memSpace, alignment);
}

NvCV_Status FxEngine::WrapCpuRgba(NvCVImage* im, uint8_t* pixels, int width, int height) {
  ZeroImage(im);
  return NvCVImage_Init(im, static_cast<unsigned>(width), static_cast<unsigned>(height), width * 4, pixels, NVCV_RGBA,
                        NVCV_U8, NVCV_CHUNKY, NVCV_CPU);
}

NvCV_Status FxEngine::TransferInBgr(const NvCVImage* cpuRgba, NvCVImage* gpuBgr, int width, int height) {
  NvCV_Status err = EnsureImage(gpuBgr, static_cast<unsigned>(width), static_cast<unsigned>(height), NVCV_BGR, NVCV_F32,
                                NVCV_PLANAR, NVCV_GPU, 1);
  if (err != NVCV_SUCCESS) return err;
  return NvCVImage_Transfer(cpuRgba, gpuBgr, 1.0f / 255.0f, stream_, &tmp_);
}

NvCV_Status FxEngine::TransferOutBgr(const NvCVImage* gpuBgr, NvCVImage* cpuRgba, int width, int height) {
  (void)width;
  (void)height;
  return NvCVImage_Transfer(gpuBgr, cpuRgba, 255.0f, stream_, &tmp_);
}

NvCV_Status FxEngine::RunLoaded(NvVFX_Handle handle, NvCVImage* src, NvCVImage* dst, bool async, bool* loaded) {
  NvCV_Status err = NvVFX_SetCudaStream(handle, NVVFX_CUDA_STREAM, stream_);
  if (err != NVCV_SUCCESS) return err;
  err = NvVFX_SetImage(handle, NVVFX_INPUT_IMAGE, src);
  if (err != NVCV_SUCCESS) return err;
  err = NvVFX_SetImage(handle, NVVFX_OUTPUT_IMAGE, dst);
  if (err != NVCV_SUCCESS) return err;
  if (!*loaded) {
    err = NvVFX_Load(handle);
    if (err != NVCV_SUCCESS) return err;
    *loaded = true;
  }
  return NvVFX_Run(handle, async ? 1 : 0);
}

void FxEngine::DestroyDenoiseState() {
  if (denoise_ && denoiseState_) {
    NvVFX_DeallocateState(denoise_, denoiseState_);
  }
  denoiseState_ = nullptr;
  denoiseStateW_ = 0;
  denoiseStateH_ = 0;
}

void FxEngine::DestroyEffects() {
  DestroyDenoiseState();
  if (ar_) {
    NvVFX_DestroyEffect(ar_);
    ar_ = nullptr;
  }
  if (denoise_) {
    NvVFX_DestroyEffect(denoise_);
    denoise_ = nullptr;
  }
  if (superRes_) {
    NvVFX_DestroyEffect(superRes_);
    superRes_ = nullptr;
  }
  if (upscale_) {
    NvVFX_DestroyEffect(upscale_);
    upscale_ = nullptr;
  }
  arLoaded_ = denoiseLoaded_ = superResLoaded_ = upscaleLoaded_ = false;
}

void FxEngine::ReleaseImages() {
  NvCVImage_Dealloc(&gpuBgrA_);
  NvCVImage_Dealloc(&gpuBgrB_);
  NvCVImage_Dealloc(&gpuRgbaIn_);
  NvCVImage_Dealloc(&gpuRgbaOut_);
  NvCVImage_Dealloc(&tmp_);
  ZeroImage(&gpuBgrA_);
  ZeroImage(&gpuBgrB_);
  ZeroImage(&gpuRgbaIn_);
  ZeroImage(&gpuRgbaOut_);
  ZeroImage(&tmp_);
}

FxResult FxEngine::InitCuda() {
  if (stream_) return OkResult(0, 0, 0);
  if (!MaxineRuntimeLoaded()) {
    FxResult r;
    r.ok = false;
    r.errorCode = NVCV_ERR_LIBRARY;
    r.error = "Maxine runtime not found";
    return r;
  }
  const NvCV_Status err = NvVFX_CudaStreamCreate(&stream_);
  if (err != NVCV_SUCCESS) {
    stream_ = nullptr;
    if (err == NVCV_ERR_LIBRARY) {
      FxResult r = Fail(err);
      r.error = "Maxine runtime not found";
      return r;
    }
    return Fail(err);
  }
  if (!ModelDirFromRuntime(modelDir_, sizeof(modelDir_))) {
    return Fail(NVCV_ERR_FILE, "NVCV_ERR_FILE");
  }
  return OkResult(0, 0, 0);
}

void FxEngine::TeardownCuda() {
  DestroyEffects();
  ReleaseImages();
  if (stream_) {
    NvVFX_CudaStreamDestroy(stream_);
    stream_ = nullptr;
  }
}

FxResult FxEngine::Configure(const FxConfig& cfg) {
  if (!stream_) {
    FxResult init = InitCuda();
    if (!init.ok) return init;
  }
  DestroyEffects();
  cfg_ = cfg;
  cfg_.superResScale = CanonicalScale(cfg.superResScale);
  cfg_.upscaleScale = CanonicalScale(cfg.upscaleScale);

  auto create = [&](NvVFX_EffectSelector sel, NvVFX_Handle* out) -> NvCV_Status {
    NvCV_Status err = NvVFX_CreateEffect(sel, out);
    if (err != NVCV_SUCCESS) return err;
    err = NvVFX_SetString(*out, NVVFX_MODEL_DIRECTORY, modelDir_);
    if (err == NVCV_ERR_SELECTOR) err = NVCV_SUCCESS;
    if (err != NVCV_SUCCESS) return err;
    return NvVFX_SetCudaStream(*out, NVVFX_CUDA_STREAM, stream_);
  };

  if (cfg_.artifactReductionEnabled) {
    NvCV_Status err = create(NVVFX_FX_ARTIFACT_REDUCTION, &ar_);
    if (err != NVCV_SUCCESS) return Fail(err);
    err = NvVFX_SetU32(ar_, NVVFX_MODE, static_cast<unsigned>(cfg_.artifactReductionMode ? 1 : 0));
    if (err != NVCV_SUCCESS) return Fail(err);
  }
  if (cfg_.denoiseEnabled) {
    NvCV_Status err = create(NVVFX_FX_DENOISING, &denoise_);
    if (err != NVCV_SUCCESS) return Fail(err);
    err = NvVFX_SetF32(denoise_, NVVFX_STRENGTH, cfg_.denoiseStrength >= 0.5f ? 1.f : 0.f);
    if (err != NVCV_SUCCESS) return Fail(err);
  }
  if (cfg_.superResEnabled) {
    NvCV_Status err = create(NVVFX_FX_SUPER_RES, &superRes_);
    if (err != NVCV_SUCCESS) return Fail(err);
    err = SetScale(superRes_, cfg_.superResScale);
    if (err != NVCV_SUCCESS) return Fail(err);
    err = SetMode(superRes_, static_cast<unsigned>(cfg_.superResMode ? 1 : 0));
    if (err != NVCV_SUCCESS) return Fail(err);
  }
  if (cfg_.upscaleEnabled) {
    NvCV_Status err = create(NVVFX_FX_SR_UPSCALE, &upscale_);
    if (err != NVCV_SUCCESS) return Fail(err);
    err = SetScale(upscale_, cfg_.upscaleScale);
    if (err != NVCV_SUCCESS) return Fail(err);
    err = NvVFX_SetF32(upscale_, NVVFX_STRENGTH, cfg_.upscaleStrength);
    if (err == NVCV_ERR_SELECTOR) err = NVCV_SUCCESS;
    if (err != NVCV_SUCCESS) return Fail(err);
  }
  return OkResult(0, 0, 0);
}

FxResult FxEngine::ResetTemporal() {
  if (!denoise_ || !denoiseState_) return OkResult(0, 0, 0);
  const NvCV_Status err = NvVFX_ResetState(denoise_, denoiseState_);
  if (err != NVCV_SUCCESS) return Fail(err);
  return OkResult(0, 0, 0);
}

FxResult FxEngine::Process(const char* stage, ShmRing& shm, int slot) {
  const double t0 = NowMs();
  if (!stage) return Fail(NVCV_ERR_PARAMETER);
  if (!shm.IsOpen()) return Fail(NVCV_ERR_INITIALIZATION, "FX shared memory is not open.");

  ShmSlotView in{};
  ShmSlotView out{};
  char errbuf[128];
  if (!shm.InputSlot(slot, &in, errbuf, sizeof(errbuf))) return Fail(NVCV_ERR_PARAMETER, "Invalid FX slot.");
  if (!shm.OutputSlot(slot, &out, errbuf, sizeof(errbuf))) return Fail(NVCV_ERR_PARAMETER, "Invalid FX slot.");

  const int inW = static_cast<int>(*in.width);
  const int inH = static_cast<int>(*in.height);
  const uint32_t inBytes = *in.bytes;
  if (inW <= 0 || inH <= 0 || inBytes != static_cast<uint32_t>(inW) * static_cast<uint32_t>(inH) * 4u) {
    return Fail(NVCV_ERR_RESOLUTION);
  }
  if (inW > static_cast<int>(kFxMaxW) || inH > static_cast<int>(kFxMaxH)) {
    return Fail(NVCV_ERR_RESOLUTION);
  }

  *in.state = kFxStateProcessing;
  *out.state = kFxStateEmpty;

  auto finishOut = [&](int width, int height) {
    const uint32_t bytes = static_cast<uint32_t>(width) * static_cast<uint32_t>(height) * 4u;
    *out.width = static_cast<uint32_t>(width);
    *out.height = static_cast<uint32_t>(height);
    *out.bytes = bytes;
    *out.pts = *in.pts;
    MemoryBarrier();
    *out.state = kFxStateReady;
    *in.state = kFxStateEmpty;
  };

  auto failProcess = [&](int code) {
    shm.SetError(code, FxStatusName(code));
    *in.state = kFxStateFilled;
    return Fail(code);
  };

  if (std::strcmp(stage, "ar-denoise") == 0) {
    if (!cfg_.artifactReductionEnabled && !cfg_.denoiseEnabled) {
      std::memcpy(out.pixels, in.pixels, inBytes);
      finishOut(inW, inH);
      return OkResult(inW, inH, NowMs() - t0);
    }
    if (!stream_) return failProcess(NVCV_ERR_INITIALIZATION);

    NvCVImage cpuIn{};
    NvCVImage cpuOut{};
    NvCV_Status err = WrapCpuRgba(&cpuIn, in.pixels, inW, inH);
    if (err != NVCV_SUCCESS) return failProcess(err);
    err = WrapCpuRgba(&cpuOut, out.pixels, inW, inH);
    if (err != NVCV_SUCCESS) return failProcess(err);
    err = TransferInBgr(&cpuIn, &gpuBgrA_, inW, inH);
    if (err != NVCV_SUCCESS) return failProcess(err);
    err = EnsureImage(&gpuBgrB_, static_cast<unsigned>(inW), static_cast<unsigned>(inH), NVCV_BGR, NVCV_F32, NVCV_PLANAR,
                      NVCV_GPU, 1);
    if (err != NVCV_SUCCESS) return failProcess(err);

    NvCVImage* src = &gpuBgrA_;
    NvCVImage* dst = &gpuBgrB_;
    const bool both = cfg_.artifactReductionEnabled && cfg_.denoiseEnabled;
    double arMs = 0;
    double dnMs = 0;

    if (cfg_.artifactReductionEnabled) {
      if (!ar_) return failProcess(NVCV_ERR_EFFECT);
      const double s = NowMs();
      err = RunLoaded(ar_, src, dst, both, &arLoaded_);
      arMs = NowMs() - s;
      if (err != NVCV_SUCCESS) return failProcess(err);
      src = dst;
      dst = &gpuBgrA_;
    }
    if (cfg_.denoiseEnabled) {
      if (!denoise_) return failProcess(NVCV_ERR_EFFECT);
      if (denoiseStateW_ != inW || denoiseStateH_ != inH) {
        DestroyDenoiseState();
      }
      const double s = NowMs();
      err = NvVFX_SetImage(denoise_, NVVFX_INPUT_IMAGE, src);
      if (err != NVCV_SUCCESS) return failProcess(err);
      err = NvVFX_SetImage(denoise_, NVVFX_OUTPUT_IMAGE, dst);
      if (err != NVCV_SUCCESS) return failProcess(err);
      err = NvVFX_SetCudaStream(denoise_, NVVFX_CUDA_STREAM, stream_);
      if (err != NVCV_SUCCESS) return failProcess(err);
      if (!denoiseLoaded_) {
        err = NvVFX_Load(denoise_);
        if (err != NVCV_SUCCESS) return failProcess(err);
        denoiseLoaded_ = true;
      }
      if (!denoiseState_) {
        err = NvVFX_AllocateState(denoise_, &denoiseState_);
        if (err != NVCV_SUCCESS) return failProcess(err);
        err = NvVFX_SetStateObjectHandleArray(denoise_, NVVFX_STATE, &denoiseState_);
        if (err != NVCV_SUCCESS) return failProcess(err);
        denoiseStateW_ = inW;
        denoiseStateH_ = inH;
      }
      err = NvVFX_Run(denoise_, 0);
      dnMs = NowMs() - s;
      if (err != NVCV_SUCCESS) return failProcess(err);
      src = dst;
    }

    err = TransferOutBgr(src, &cpuOut, inW, inH);
    if (err != NVCV_SUCCESS) return failProcess(err);
    finishOut(inW, inH);
    FxResult r = OkResult(inW, inH, NowMs() - t0);
    r.artifactReductionMs = arMs;
    r.denoiseMs = dnMs;
    return r;
  }

  if (std::strcmp(stage, "superres") == 0) {
    if (!cfg_.superResEnabled || !superRes_) return failProcess(NVCV_ERR_EFFECT);
    if (!stream_) return failProcess(NVCV_ERR_INITIALIZATION);
    const int outW = ScaledDim(inW, cfg_.superResScale);
    const int outH = ScaledDim(inH, cfg_.superResScale);
    if (outW <= 0 || outH <= 0 || outW > static_cast<int>(kFxMaxW) || outH > static_cast<int>(kFxMaxH)) {
      return failProcess(NVCV_ERR_RESOLUTION);
    }
    NvCVImage cpuIn{};
    NvCVImage cpuOut{};
    NvCV_Status err = WrapCpuRgba(&cpuIn, in.pixels, inW, inH);
    if (err != NVCV_SUCCESS) return failProcess(err);
    err = WrapCpuRgba(&cpuOut, out.pixels, outW, outH);
    if (err != NVCV_SUCCESS) return failProcess(err);
    err = TransferInBgr(&cpuIn, &gpuBgrA_, inW, inH);
    if (err != NVCV_SUCCESS) return failProcess(err);
    err = EnsureImage(&gpuBgrB_, static_cast<unsigned>(outW), static_cast<unsigned>(outH), NVCV_BGR, NVCV_F32,
                      NVCV_PLANAR, NVCV_GPU, 1);
    if (err != NVCV_SUCCESS) return failProcess(err);
    const double s = NowMs();
    err = SetScale(superRes_, cfg_.superResScale);
    if (err != NVCV_SUCCESS) return failProcess(err);
    err = RunLoaded(superRes_, &gpuBgrA_, &gpuBgrB_, false, &superResLoaded_);
    const double srMs = NowMs() - s;
    if (err != NVCV_SUCCESS) return failProcess(err);
    err = TransferOutBgr(&gpuBgrB_, &cpuOut, outW, outH);
    if (err != NVCV_SUCCESS) return failProcess(err);
    finishOut(outW, outH);
    FxResult r = OkResult(outW, outH, NowMs() - t0);
    r.superResMs = srMs;
    return r;
  }

  if (std::strcmp(stage, "upscale") == 0) {
    if (!cfg_.upscaleEnabled || !upscale_) return failProcess(NVCV_ERR_EFFECT);
    if (!stream_) return failProcess(NVCV_ERR_INITIALIZATION);
    const int outW = ScaledDim(inW, cfg_.upscaleScale);
    const int outH = ScaledDim(inH, cfg_.upscaleScale);
    if (outW <= 0 || outH <= 0 || outW > static_cast<int>(kFxMaxW) || outH > static_cast<int>(kFxMaxH)) {
      return failProcess(NVCV_ERR_RESOLUTION);
    }
    NvCVImage cpuIn{};
    NvCVImage cpuOut{};
    NvCV_Status err = WrapCpuRgba(&cpuIn, in.pixels, inW, inH);
    if (err != NVCV_SUCCESS) return failProcess(err);
    err = WrapCpuRgba(&cpuOut, out.pixels, outW, outH);
    if (err != NVCV_SUCCESS) return failProcess(err);
    err = EnsureImage(&gpuRgbaIn_, static_cast<unsigned>(inW), static_cast<unsigned>(inH), NVCV_RGBA, NVCV_U8,
                      NVCV_CHUNKY, NVCV_GPU, 32);
    if (err != NVCV_SUCCESS) return failProcess(err);
    err = EnsureImage(&gpuRgbaOut_, static_cast<unsigned>(outW), static_cast<unsigned>(outH), NVCV_RGBA, NVCV_U8,
                      NVCV_CHUNKY, NVCV_GPU, 32);
    if (err != NVCV_SUCCESS) return failProcess(err);
    err = NvCVImage_Transfer(&cpuIn, &gpuRgbaIn_, 1.0f, stream_, &tmp_);
    if (err != NVCV_SUCCESS) return failProcess(err);
    const double s = NowMs();
    err = SetScale(upscale_, cfg_.upscaleScale);
    if (err != NVCV_SUCCESS) return failProcess(err);
    err = NvVFX_SetF32(upscale_, NVVFX_STRENGTH, cfg_.upscaleStrength);
    if (err == NVCV_ERR_SELECTOR) err = NVCV_SUCCESS;
    if (err != NVCV_SUCCESS) return failProcess(err);
    err = RunLoaded(upscale_, &gpuRgbaIn_, &gpuRgbaOut_, false, &upscaleLoaded_);
    const double upMs = NowMs() - s;
    if (err != NVCV_SUCCESS) return failProcess(err);
    err = NvCVImage_Transfer(&gpuRgbaOut_, &cpuOut, 1.0f, stream_, &tmp_);
    if (err != NVCV_SUCCESS) return failProcess(err);
    finishOut(outW, outH);
    FxResult r = OkResult(outW, outH, NowMs() - t0);
    r.upscaleMs = upMs;
    return r;
  }

  return failProcess(NVCV_ERR_SELECTOR);
}
