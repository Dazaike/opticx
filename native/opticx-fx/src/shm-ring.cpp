#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include "shm-ring.h"

#include <windows.h>

#include <cstdio>
#include <cstring>

namespace {

constexpr wchar_t kInName[] = L"OpticXFxIn";
constexpr wchar_t kOutName[] = L"OpticXFxOut";
constexpr wchar_t kReqName[] = L"OpticXFxReq";
constexpr wchar_t kAckName[] = L"OpticXFxAck";

void SetErrorMsg(char* error, size_t errorCap, const char* msg) {
  if (!error || errorCap == 0) return;
  std::snprintf(error, errorCap, "%s", msg);
}

uint32_t LoadU32(const uint8_t* base, uint32_t offset) {
  uint32_t value;
  std::memcpy(&value, base + offset, sizeof(value));
  return value;
}

void StoreU32(uint8_t* base, uint32_t offset, uint32_t value) {
  std::memcpy(base + offset, &value, sizeof(value));
}

void StoreF32(uint8_t* base, uint32_t offset, float value) {
  std::memcpy(base + offset, &value, sizeof(value));
}

float LoadF32(const uint8_t* base, uint32_t offset) {
  float value = 0.f;
  std::memcpy(&value, base + offset, sizeof(value));
  return value;
}

}  // namespace

void ShmRing::InitHeader(uint8_t* base) {
  std::memset(base, 0, kFxTotal);
  StoreU32(base, 0x00, kFxMagic);
  StoreU32(base, 0x04, kFxVersion);
  StoreU32(base, 0x08, kFxSlotCount);
  StoreU32(base, 0x0c, kFxMaxW);
  StoreU32(base, 0x10, kFxMaxH);
  StoreU32(base, 0x14, kFxSlotStride);
  StoreU32(base, 0x18, kFxHeaderSize);
  StoreU32(base, 0x1c, 0);
  StoreU32(base, 0x20, 0);
}

bool ShmRing::MapOne(const wchar_t* name, HANDLE* mapping, uint8_t** region, char* error, size_t errorCap) {
  HANDLE map = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0, static_cast<DWORD>(kFxTotal), name);
  if (!map) {
    SetErrorMsg(error, errorCap, "CreateFileMappingW failed.");
    return false;
  }
  const DWORD already = GetLastError();
  uint8_t* view = static_cast<uint8_t*>(MapViewOfFile(map, FILE_MAP_ALL_ACCESS, 0, 0, kFxTotal));
  if (!view) {
    CloseHandle(map);
    SetErrorMsg(error, errorCap, "MapViewOfFile failed.");
    return false;
  }
  if (already != ERROR_ALREADY_EXISTS || LoadU32(view, 0x00) != kFxMagic) {
    InitHeader(view);
  }
  *mapping = map;
  *region = view;
  return true;
}

bool ShmRing::Open(char* error, size_t errorCap) {
  if (IsOpen()) return true;
  if (!MapOne(kInName, &in_map_, &in_, error, errorCap)) return false;
  if (!MapOne(kOutName, &out_map_, &out_, error, errorCap)) {
    Close();
    return false;
  }
  req_ = CreateEventW(nullptr, FALSE, FALSE, kReqName);
  ack_ = CreateEventW(nullptr, FALSE, FALSE, kAckName);
  if (!req_ || !ack_) {
    Close();
    SetErrorMsg(error, errorCap, "CreateEventW failed.");
    return false;
  }
  return true;
}

void ShmRing::Close() {
  if (in_) {
    UnmapViewOfFile(in_);
    in_ = nullptr;
  }
  if (out_) {
    UnmapViewOfFile(out_);
    out_ = nullptr;
  }
  if (in_map_) {
    CloseHandle(in_map_);
    in_map_ = nullptr;
  }
  if (out_map_) {
    CloseHandle(out_map_);
    out_map_ = nullptr;
  }
  if (req_) {
    CloseHandle(req_);
    req_ = nullptr;
  }
  if (ack_) {
    CloseHandle(ack_);
    ack_ = nullptr;
  }
}

bool ShmRing::SlotView(uint8_t* base, int slot, ShmSlotView* view, char* error, size_t errorCap) {
  if (slot < 0 || slot >= static_cast<int>(kFxSlotCount) || !base) {
    SetErrorMsg(error, errorCap, "Invalid FX slot.");
    return false;
  }
  uint8_t* header = base + kFxHeaderSize + static_cast<size_t>(slot) * kFxSlotStride;
  view->state = reinterpret_cast<uint32_t*>(header + 0x00);
  view->width = reinterpret_cast<uint32_t*>(header + 0x04);
  view->height = reinterpret_cast<uint32_t*>(header + 0x08);
  view->bytes = reinterpret_cast<uint32_t*>(header + 0x0c);
  view->pts = reinterpret_cast<uint64_t*>(header + 0x10);
  view->pixels = header + kFxSlotHeader;
  return true;
}

bool ShmRing::InputSlot(int slot, ShmSlotView* view, char* error, size_t errorCap) const {
  return SlotView(in_, slot, view, error, errorCap);
}

bool ShmRing::OutputSlot(int slot, ShmSlotView* view, char* error, size_t errorCap) const {
  return SlotView(out_, slot, view, error, errorCap);
}

bool ShmRing::WriteInput(const uint8_t* rgba, int width, int height, uint64_t pts, int* slot, char* error,
                         size_t errorCap) {
  if (!IsOpen()) {
    SetErrorMsg(error, errorCap, "FX shared memory is not open.");
    return false;
  }
  if (!rgba || width <= 0 || height <= 0 || width > static_cast<int>(kFxMaxW) || height > static_cast<int>(kFxMaxH)) {
    SetErrorMsg(error, errorCap, "NVCV_ERR_RESOLUTION");
    return false;
  }
  const uint32_t bytes = static_cast<uint32_t>(width) * static_cast<uint32_t>(height) * 4u;
  const uint32_t next = InterlockedIncrement(reinterpret_cast<volatile long*>(in_ + 0x1c));
  const int index = static_cast<int>((next - 1u) % kFxSlotCount);
  ShmSlotView view{};
  if (!InputSlot(index, &view, error, errorCap)) return false;
  *view.state = kFxStateEmpty;
  MemoryBarrier();
  std::memcpy(view.pixels, rgba, bytes);
  *view.width = static_cast<uint32_t>(width);
  *view.height = static_cast<uint32_t>(height);
  *view.bytes = bytes;
  *view.pts = pts;
  MemoryBarrier();
  *view.state = kFxStateFilled;
  if (slot) *slot = index;
  return true;
}

void ShmRing::SetError(int code, const char* msg) {
  if (!in_) return;
  StoreU32(in_, 0x20, static_cast<uint32_t>(code));
  char* dst = reinterpret_cast<char*>(in_ + 0x24);
  if (msg) {
    std::snprintf(dst, 128, "%s", msg);
  } else {
    dst[0] = 0;
  }
}

bool ShmRing::Issue(uint32_t cmd, uint32_t stage, uint32_t slot, const FxHostConfig* cfg, char* error,
                    size_t errorCap) {
  if (!IsOpen() || !req_) {
    SetErrorMsg(error, errorCap, "FX shared memory is not open.");
    return false;
  }
  StoreU32(in_, kFxOffStatus, kFxStBusy);
  StoreU32(in_, kFxOffStage, stage);
  StoreU32(in_, kFxOffSlot, slot);
  StoreU32(in_, kFxOffErrCode, 0);
  if (cfg) {
    uint32_t bits = 0;
    if (cfg->artifactReductionEnabled) bits |= 1u;
    if (cfg->denoiseEnabled) bits |= 2u;
    if (cfg->superResEnabled) bits |= 4u;
    if (cfg->upscaleEnabled) bits |= 8u;
    if (cfg->artifactReductionMode) bits |= 16u;
    if (cfg->superResMode) bits |= 32u;
    if (cfg->denoiseStrength >= 0.5f) bits |= 64u;
    StoreU32(in_, kFxOffCfgBits, bits);
    StoreF32(in_, kFxOffSrScale, cfg->superResScale);
    StoreF32(in_, kFxOffUpScale, cfg->upscaleScale);
    StoreF32(in_, kFxOffUpStrength, cfg->upscaleStrength);
  }
  StoreU32(in_, kFxOffCmd, cmd);
  if (!SetEvent(req_)) {
    SetErrorMsg(error, errorCap, "SetEvent failed.");
    return false;
  }
  return true;
}

bool ShmRing::WaitAck(uint32_t timeoutMs, uint32_t* status, int* errorCode, float* ms, char* error,
                      size_t errorCap) {
  if (!ack_) {
    SetErrorMsg(error, errorCap, "FX ack event missing.");
    return false;
  }
  const DWORD wait = WaitForSingleObject(ack_, timeoutMs);
  if (wait != WAIT_OBJECT_0) {
    SetErrorMsg(error, errorCap, wait == WAIT_TIMEOUT ? "FX host timed out." : "FX host wait failed.");
    return false;
  }
  if (status) *status = LoadU32(in_, kFxOffStatus);
  if (errorCode) *errorCode = static_cast<int>(LoadU32(in_, kFxOffErrCode));
  if (ms) *ms = LoadF32(in_, kFxOffMs);
  if (error && errorCap) {
    const char* msg = reinterpret_cast<const char*>(in_ + 0x24);
    std::snprintf(error, errorCap, "%s", msg);
  }
  return true;
}

bool ShmRing::WaitRequest(uint32_t timeoutMs) {
  if (!req_) return false;
  return WaitForSingleObject(req_, timeoutMs) == WAIT_OBJECT_0;
}

void ShmRing::ReadCommand(uint32_t* cmd, uint32_t* stage, uint32_t* slot, FxHostConfig* cfg) {
  if (cmd) *cmd = LoadU32(in_, kFxOffCmd);
  if (stage) *stage = LoadU32(in_, kFxOffStage);
  if (slot) *slot = LoadU32(in_, kFxOffSlot);
  if (cfg && in_) {
    const uint32_t bits = LoadU32(in_, kFxOffCfgBits);
    cfg->artifactReductionEnabled = (bits & 1u) != 0;
    cfg->denoiseEnabled = (bits & 2u) != 0;
    cfg->superResEnabled = (bits & 4u) != 0;
    cfg->upscaleEnabled = (bits & 8u) != 0;
    cfg->artifactReductionMode = (bits & 16u) ? 1 : 0;
    cfg->superResMode = (bits & 32u) ? 1 : 0;
    cfg->denoiseStrength = (bits & 64u) ? 1.f : 0.f;
    cfg->superResScale = LoadF32(in_, kFxOffSrScale);
    cfg->upscaleScale = LoadF32(in_, kFxOffUpScale);
    cfg->upscaleStrength = LoadF32(in_, kFxOffUpStrength);
  }
}

void ShmRing::Complete(uint32_t status, int errorCode, float ms, const char* error) {
  StoreU32(in_, kFxOffStatus, status);
  StoreU32(in_, kFxOffErrCode, static_cast<uint32_t>(errorCode));
  StoreF32(in_, kFxOffMs, ms);
  SetError(errorCode, error);
  StoreU32(in_, kFxOffCmd, kFxCmdNone);
  if (ack_) SetEvent(ack_);
}
