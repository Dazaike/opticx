#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include "fx-engine.h"
#include "shm-ring.h"

#include <windows.h>

namespace {

FxConfig ToEngineConfig(const FxHostConfig& in) {
  FxConfig cfg;
  cfg.artifactReductionEnabled = in.artifactReductionEnabled;
  cfg.artifactReductionMode = in.artifactReductionMode;
  cfg.denoiseEnabled = in.denoiseEnabled;
  cfg.denoiseStrength = in.denoiseStrength;
  cfg.superResEnabled = in.superResEnabled;
  cfg.superResScale = in.superResScale;
  cfg.superResMode = in.superResMode;
  cfg.upscaleEnabled = in.upscaleEnabled;
  cfg.upscaleScale = in.upscaleScale;
  cfg.upscaleStrength = in.upscaleStrength;
  return cfg;
}

const char* StageName(uint32_t stage) {
  if (stage == 1) return "superres";
  if (stage == 2) return "upscale";
  return "ar-denoise";
}

}  // namespace

int main() {
  ShmRing shm;
  char error[256] = {};
  if (!shm.Open(error, sizeof(error))) return 2;

  FxEngine engine;
  shm.Complete(kFxStOk, 0, 0.f, nullptr);

  for (;;) {
    if (!shm.WaitRequest(INFINITE)) break;
    uint32_t cmd = 0;
    uint32_t stage = 0;
    uint32_t slot = 0;
    FxHostConfig cfg;
    shm.ReadCommand(&cmd, &stage, &slot, &cfg);

    if (cmd == kFxCmdQuit) {
      engine.TeardownCuda();
      shm.Complete(kFxStOk, 0, 0.f, nullptr);
      break;
    }
    if (cmd == kFxCmdReset) {
      const FxResult r = engine.ResetTemporal();
      shm.Complete(r.ok ? kFxStOk : kFxStErr, r.errorCode, static_cast<float>(r.ms), r.error);
      continue;
    }
    if (cmd == kFxCmdConfigure) {
      const FxResult r = engine.Configure(ToEngineConfig(cfg));
      shm.Complete(r.ok ? kFxStOk : kFxStErr, r.errorCode, static_cast<float>(r.ms), r.error);
      continue;
    }
    if (cmd == kFxCmdProcess) {
      const FxResult r = engine.Process(StageName(stage), shm, static_cast<int>(slot));
      shm.Complete(r.ok ? kFxStOk : kFxStErr, r.errorCode, static_cast<float>(r.ms), r.error);
      continue;
    }
    shm.Complete(kFxStOk, 0, 0.f, nullptr);
  }
  return 0;
}
