#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>


#include <cstdint>
#include <cstddef>

constexpr uint32_t kFxMagic = 0x58465058u;
constexpr uint32_t kFxVersion = 1;
constexpr uint32_t kFxSlotCount = 4;
constexpr uint32_t kFxMaxW = 3840;
constexpr uint32_t kFxMaxH = 2160;
constexpr uint32_t kFxHeaderSize = 256;
constexpr uint32_t kFxSlotHeader = 64;
constexpr uint32_t kFxSlotPayload = kFxMaxW * kFxMaxH * 4u;
constexpr uint32_t kFxSlotStride = kFxSlotHeader + kFxSlotPayload;
constexpr size_t kFxTotal = static_cast<size_t>(kFxHeaderSize) + static_cast<size_t>(kFxSlotCount) * kFxSlotStride;

constexpr uint32_t kFxStateEmpty = 0;
constexpr uint32_t kFxStateFilled = 1;
constexpr uint32_t kFxStateProcessing = 2;
constexpr uint32_t kFxStateReady = 3;

constexpr uint32_t kFxCmdNone = 0;
constexpr uint32_t kFxCmdReady = 1;
constexpr uint32_t kFxCmdConfigure = 2;
constexpr uint32_t kFxCmdProcess = 3;
constexpr uint32_t kFxCmdReset = 4;
constexpr uint32_t kFxCmdQuit = 5;

constexpr uint32_t kFxStIdle = 0;
constexpr uint32_t kFxStBusy = 1;
constexpr uint32_t kFxStOk = 2;
constexpr uint32_t kFxStErr = 3;

constexpr uint32_t kFxOffCmd = 0xA8;
constexpr uint32_t kFxOffStage = 0xAC;
constexpr uint32_t kFxOffSlot = 0xB0;
constexpr uint32_t kFxOffStatus = 0xB4;
constexpr uint32_t kFxOffErrCode = 0xB8;
constexpr uint32_t kFxOffCfgBits = 0xBC;
constexpr uint32_t kFxOffSrScale = 0xC0;
constexpr uint32_t kFxOffUpScale = 0xC4;
constexpr uint32_t kFxOffUpStrength = 0xC8;
constexpr uint32_t kFxOffMs = 0xCC;

struct ShmSlotView {
  uint32_t* state;
  uint32_t* width;
  uint32_t* height;
  uint32_t* bytes;
  uint64_t* pts;
  uint8_t* pixels;
};

struct FxHostConfig {
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

class ShmRing {
 public:
  ~ShmRing() { Close(); }

  bool Open(char* error, size_t errorCap);
  void Close();
  bool IsOpen() const { return in_ != nullptr && out_ != nullptr; }

  bool WriteInput(const uint8_t* rgba, int width, int height, uint64_t pts, int* slot, char* error, size_t errorCap);
  bool InputSlot(int slot, ShmSlotView* view, char* error, size_t errorCap) const;
  bool OutputSlot(int slot, ShmSlotView* view, char* error, size_t errorCap) const;
  void SetError(int code, const char* msg);

  bool Issue(uint32_t cmd, uint32_t stage, uint32_t slot, const FxHostConfig* cfg, char* error, size_t errorCap);
  bool WaitAck(uint32_t timeoutMs, uint32_t* status, int* errorCode, float* ms, char* error, size_t errorCap);
  bool WaitRequest(uint32_t timeoutMs);
  void ReadCommand(uint32_t* cmd, uint32_t* stage, uint32_t* slot, FxHostConfig* cfg);
  void Complete(uint32_t status, int errorCode, float ms, const char* error);

 private:
  bool MapOne(const wchar_t* name, HANDLE* mapping, uint8_t** region, char* error, size_t errorCap);
  static bool SlotView(uint8_t* base, int slot, ShmSlotView* view, char* error, size_t errorCap);
  static void InitHeader(uint8_t* base);

  HANDLE in_map_ = nullptr;
  HANDLE out_map_ = nullptr;
  HANDLE req_ = nullptr;
  HANDLE ack_ = nullptr;
  uint8_t* in_ = nullptr;
  uint8_t* out_ = nullptr;
};
