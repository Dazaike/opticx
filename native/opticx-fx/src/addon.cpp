#define NAPI_VERSION 8

#include <napi.h>

#include "nvCVStatus.h"
#include "shm-ring.h"

#include <cstring>
#include <string>

namespace {

ShmRing g_shm;

Napi::Object ResultOk(Napi::Env env) {
  Napi::Object o = Napi::Object::New(env);
  o.Set("ok", true);
  return o;
}

Napi::Object ResultErr(Napi::Env env, const char* error, int errorCode = 0) {
  Napi::Object o = Napi::Object::New(env);
  o.Set("ok", false);
  if (error) o.Set("error", error);
  if (errorCode != 0) o.Set("errorCode", errorCode);
  return o;
}

int ModeFromString(const std::string& mode) { return mode == "agg" ? 1 : 0; }

bool ReadStageConfig(Napi::Object root, const char* key, Napi::Object* out) {
  if (!root.Has(key)) return false;
  Napi::Value v = root.Get(key);
  if (!v.IsObject()) return false;
  *out = v.As<Napi::Object>();
  return true;
}

Napi::Value Open(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  char error[256] = {};
  if (!g_shm.Open(error, sizeof(error))) return ResultErr(env, error);
  return ResultOk(env);
}

Napi::Value Close(const Napi::CallbackInfo& info) {
  g_shm.Close();
  return info.Env().Undefined();
}

Napi::Value WriteInput(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4 || !info[0].IsTypedArray() || !info[1].IsNumber() || !info[2].IsNumber() ||
      !info[3].IsBigInt()) {
    return ResultErr(env, "writeInput(rgba, width, height, pts)");
  }
  Napi::Uint8Array rgba = info[0].As<Napi::Uint8Array>();
  const int width = info[1].As<Napi::Number>().Int32Value();
  const int height = info[2].As<Napi::Number>().Int32Value();
  bool lossless = false;
  const uint64_t pts = info[3].As<Napi::BigInt>().Uint64Value(&lossless);
  if (width <= 0 || height <= 0) return ResultErr(env, "NVCV_ERR_RESOLUTION", NVCV_ERR_RESOLUTION);
  const size_t need = static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
  if (rgba.ByteLength() < need) return ResultErr(env, "RGBA buffer is too small.");
  char error[256] = {};
  int slot = -1;
  if (!g_shm.WriteInput(rgba.Data(), width, height, pts, &slot, error, sizeof(error))) {
    const int code = std::strcmp(error, "NVCV_ERR_RESOLUTION") == 0 ? NVCV_ERR_RESOLUTION : 0;
    return ResultErr(env, error, code);
  }
  Napi::Object o = ResultOk(env);
  o.Set("slot", slot);
  return o;
}

Napi::Value ReadOutput(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) return ResultErr(env, "readOutput(slot)");
  const int slot = info[0].As<Napi::Number>().Int32Value();
  ShmSlotView view{};
  char error[256] = {};
  if (!g_shm.OutputSlot(slot, &view, error, sizeof(error))) return ResultErr(env, error);
  if (*view.state != kFxStateReady) return ResultErr(env, "Output slot is not ready.");
  const uint32_t width = *view.width;
  const uint32_t height = *view.height;
  const uint32_t bytes = *view.bytes;
  if (bytes != width * height * 4u) return ResultErr(env, "NVCV_ERR_MISMATCH", NVCV_ERR_MISMATCH);
  Napi::ArrayBuffer ab = Napi::ArrayBuffer::New(env, bytes);
  std::memcpy(ab.Data(), view.pixels, bytes);
  Napi::Uint8Array rgba = Napi::Uint8Array::New(env, bytes, ab, 0);
  Napi::Object o = ResultOk(env);
  o.Set("rgba", rgba);
  o.Set("width", static_cast<int>(width));
  o.Set("height", static_cast<int>(height));
  return o;
}

Napi::Value Issue(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) return ResultErr(env, "issue(command)");
  Napi::Object cmdObj = info[0].As<Napi::Object>();
  uint32_t cmd = kFxCmdNone;
  if (cmdObj.Has("cmd") && cmdObj.Get("cmd").IsNumber()) {
    cmd = cmdObj.Get("cmd").As<Napi::Number>().Uint32Value();
  }
  uint32_t stage = 0;
  if (cmdObj.Has("stage") && cmdObj.Get("stage").IsNumber()) {
    stage = cmdObj.Get("stage").As<Napi::Number>().Uint32Value();
  }
  uint32_t slot = 0;
  if (cmdObj.Has("slot") && cmdObj.Get("slot").IsNumber()) {
    slot = cmdObj.Get("slot").As<Napi::Number>().Uint32Value();
  }
  FxHostConfig cfg;
  Napi::Object stageObj;
  if (ReadStageConfig(cmdObj, "artifactReduction", &stageObj)) {
    if (stageObj.Has("enabled") && stageObj.Get("enabled").IsBoolean()) {
      cfg.artifactReductionEnabled = stageObj.Get("enabled").As<Napi::Boolean>().Value();
    }
    if (stageObj.Has("mode") && stageObj.Get("mode").IsString()) {
      cfg.artifactReductionMode = ModeFromString(stageObj.Get("mode").As<Napi::String>().Utf8Value());
    }
  }
  if (ReadStageConfig(cmdObj, "denoise", &stageObj)) {
    if (stageObj.Has("enabled") && stageObj.Get("enabled").IsBoolean()) {
      cfg.denoiseEnabled = stageObj.Get("enabled").As<Napi::Boolean>().Value();
    }
    if (stageObj.Has("strength") && stageObj.Get("strength").IsNumber()) {
      cfg.denoiseStrength = stageObj.Get("strength").As<Napi::Number>().FloatValue() >= 0.5f ? 1.f : 0.f;
    }
  }
  if (ReadStageConfig(cmdObj, "superRes", &stageObj)) {
    if (stageObj.Has("enabled") && stageObj.Get("enabled").IsBoolean()) {
      cfg.superResEnabled = stageObj.Get("enabled").As<Napi::Boolean>().Value();
    }
    if (stageObj.Has("scale") && stageObj.Get("scale").IsNumber()) {
      cfg.superResScale = stageObj.Get("scale").As<Napi::Number>().FloatValue();
    }
    if (stageObj.Has("mode") && stageObj.Get("mode").IsString()) {
      cfg.superResMode = ModeFromString(stageObj.Get("mode").As<Napi::String>().Utf8Value());
    }
  }
  if (ReadStageConfig(cmdObj, "fastUpscale", &stageObj)) {
    if (stageObj.Has("enabled") && stageObj.Get("enabled").IsBoolean()) {
      cfg.upscaleEnabled = stageObj.Get("enabled").As<Napi::Boolean>().Value();
    }
    if (stageObj.Has("scale") && stageObj.Get("scale").IsNumber()) {
      cfg.upscaleScale = stageObj.Get("scale").As<Napi::Number>().FloatValue();
    }
    if (stageObj.Has("strength") && stageObj.Get("strength").IsNumber()) {
      cfg.upscaleStrength = stageObj.Get("strength").As<Napi::Number>().FloatValue();
    }
  }
  char error[256] = {};
  if (!g_shm.Issue(cmd, stage, slot, &cfg, error, sizeof(error))) return ResultErr(env, error);
  return ResultOk(env);
}

class AckWorker : public Napi::AsyncWorker {
 public:
  AckWorker(Napi::Env env, uint32_t timeoutMs)
      : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)), timeoutMs_(timeoutMs) {}

  Napi::Promise Promise() { return deferred_.Promise(); }

  void Execute() override {
    waited_ = g_shm.WaitAck(timeoutMs_, &status_, &errorCode_, &ms_, error_, sizeof(error_));
  }

  void OnOK() override {
    Napi::Env env = Env();
    Napi::Object o = Napi::Object::New(env);
    const bool ok = waited_ && status_ == kFxStOk;
    o.Set("ok", ok);
    o.Set("status", status_);
    o.Set("errorCode", errorCode_);
    o.Set("ms", ms_);
    if (!ok && error_[0]) o.Set("error", error_);
    if (!ok && !error_[0]) o.Set("error", "FX host failed");
    deferred_.Resolve(o);
  }

 private:
  Napi::Promise::Deferred deferred_;
  uint32_t timeoutMs_;
  bool waited_ = false;
  uint32_t status_ = 0;
  int errorCode_ = 0;
  float ms_ = 0.f;
  char error_[256] = {};
};

Napi::Value WaitAck(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  uint32_t timeoutMs = 20000;
  if (info.Length() >= 1 && info[0].IsNumber()) {
    timeoutMs = info[0].As<Napi::Number>().Uint32Value();
  }
  auto* worker = new AckWorker(env, timeoutMs);
  Napi::Promise promise = worker->Promise();
  worker->Queue();
  return promise;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("open", Napi::Function::New(env, Open));
  exports.Set("close", Napi::Function::New(env, Close));
  exports.Set("writeInput", Napi::Function::New(env, WriteInput));
  exports.Set("readOutput", Napi::Function::New(env, ReadOutput));
  exports.Set("issue", Napi::Function::New(env, Issue));
  exports.Set("waitAck", Napi::Function::New(env, WaitAck));
  return exports;
}

}  // namespace

NODE_API_MODULE(opticx_fx, Init)
