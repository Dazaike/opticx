#pragma once

#include "nvVideoEffects.h"
#include "shm-ring.h"

struct FxConfig {
  bool artifactReductionEnabled = false;
  int artifactReductionMode = 0;
  bool denoiseEnabled = false;
  float denoiseStrength = 0.f;
  bool superResEnabled = false;
  float superResScale = 2.f;
  int superResMode = 0;
  bool upscaleEnabled = false;
  float upscaleScale = 2.f;
  float upscaleStrength = 0.4f;
};

struct FxResult {
  bool ok = false;
  int width = 0;
  int height = 0;
  double ms = 0;
  double artifactReductionMs = 0;
  double denoiseMs = 0;
  double superResMs = 0;
  double upscaleMs = 0;
  int errorCode = 0;
  const char* error = nullptr;
};

const char* FxStatusName(int code);
void FxRuntimeNotFoundMessage(char* buf, size_t cap);

class FxEngine {
 public:
  ~FxEngine() { TeardownCuda(); }

  FxResult InitCuda();
  void TeardownCuda();
  bool CudaReady() const { return stream_ != nullptr; }

  FxResult Configure(const FxConfig& cfg);
  FxResult ResetTemporal();
  FxResult Process(const char* stage, ShmRing& shm, int slot);

 private:
  void DestroyEffects();
  void DestroyDenoiseState();
  void ReleaseImages();
  NvCV_Status EnsureImage(NvCVImage* im, unsigned width, unsigned height, NvCVImage_PixelFormat format,
                          NvCVImage_ComponentType type, unsigned layout, unsigned memSpace, unsigned alignment);
  NvCV_Status WrapCpuRgba(NvCVImage* im, uint8_t* pixels, int width, int height);
  NvCV_Status TransferInBgr(const NvCVImage* cpuRgba, NvCVImage* gpuBgr, int width, int height);
  NvCV_Status TransferOutBgr(const NvCVImage* gpuBgr, NvCVImage* cpuRgba, int width, int height);
  NvCV_Status RunLoaded(NvVFX_Handle handle, NvCVImage* src, NvCVImage* dst, bool async, bool* loaded);
  int ScaledDim(int value, float scale) const;
  float CanonicalScale(float scale) const;

  FxConfig cfg_{};
  CUstream stream_ = nullptr;
  char modelDir_[260] = {};

  NvVFX_Handle ar_ = nullptr;
  NvVFX_Handle denoise_ = nullptr;
  NvVFX_Handle superRes_ = nullptr;
  NvVFX_Handle upscale_ = nullptr;
  NvVFX_StateObjectHandle denoiseState_ = nullptr;
  bool arLoaded_ = false;
  bool denoiseLoaded_ = false;
  bool superResLoaded_ = false;
  bool upscaleLoaded_ = false;
  int denoiseStateW_ = 0;
  int denoiseStateH_ = 0;

  NvCVImage tmp_{};
  NvCVImage gpuBgrA_{};
  NvCVImage gpuBgrB_{};
  NvCVImage gpuRgbaIn_{};
  NvCVImage gpuRgbaOut_{};
};
