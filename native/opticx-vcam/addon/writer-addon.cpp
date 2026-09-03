#include <node_api.h>
#include <windows.h>

#include <cstdint>
#include <cstring>

namespace {

constexpr wchar_t kSectionName[] = L"OpticXCamVideo4K";
constexpr wchar_t kProducerMutexName[] = L"OpticXCamProducer4K";
constexpr uint32_t kWidth = 3840;
constexpr uint32_t kHeight = 2160;
constexpr size_t kFrameBytes = kWidth * kHeight * 3 / 2;
constexpr size_t kHeaderSize = 0x50;
constexpr size_t kFrameHeaderSize = 32;
constexpr size_t kSlotCount = 3;
constexpr size_t kFirstSlotOffset = 0x60;
constexpr size_t kTotalSize = 0x23988C0;
constexpr uint32_t kStateStarting = 1;
constexpr uint32_t kStateReady = 2;
constexpr uint32_t kStateStopping = 3;

HANDLE g_mapping = nullptr;
HANDLE g_producer_mutex = nullptr;
uint8_t* g_region = nullptr;
uint32_t g_write_index = 0;

void SetU32(size_t offset, uint32_t value) {
  std::memcpy(g_region + offset, &value, sizeof(value));
}

void SetU64(size_t offset, uint64_t value) {
  std::memcpy(g_region + offset, &value, sizeof(value));
}

napi_value Error(napi_env env, const char* message) {
  napi_throw_error(env, nullptr, message);
  return nullptr;
}

napi_value Result(napi_env env, bool ok, const char* error = nullptr) {
  napi_value result;
  napi_create_object(env, &result);
  napi_value ok_value;
  napi_get_boolean(env, ok, &ok_value);
  napi_set_named_property(env, result, "ok", ok_value);
  if (error != nullptr) {
    napi_value error_value;
    napi_create_string_utf8(env, error, NAPI_AUTO_LENGTH, &error_value);
    napi_set_named_property(env, result, "error", error_value);
  }
  return result;
}

void StopWriter() {
  if (g_region != nullptr) {
    SetU32(0x08, kStateStopping);
    UnmapViewOfFile(g_region);
    g_region = nullptr;
  }
  if (g_mapping != nullptr) {
    CloseHandle(g_mapping);
    g_mapping = nullptr;
  }
  if (g_producer_mutex != nullptr) {
    CloseHandle(g_producer_mutex);
    g_producer_mutex = nullptr;
  }
  g_write_index = 0;
}

napi_value Start(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  uint32_t fps = 30;
  if (argc == 1 && napi_get_value_uint32(env, args[0], &fps) != napi_ok) {
    return Error(env, "OpticX Cam FPS must be a number.");
  }
  if (fps != 30 && fps != 60) {
    return Error(env, "OpticX Cam supports 30 or 60 FPS.");
  }
  if (g_region != nullptr) return Result(env, true);

  HANDLE producer_mutex = CreateMutexW(nullptr, FALSE, kProducerMutexName);
  const DWORD mutex_error = GetLastError();
  if (producer_mutex == nullptr) return Result(env, false, "Could not create the OpticX Cam producer lock.");
  if (mutex_error == ERROR_ALREADY_EXISTS) {
    CloseHandle(producer_mutex);
    return Result(env, false, "Another OpticX Cam producer is already running.");
  }

  HANDLE mapping = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0,
                                      static_cast<DWORD>(kTotalSize), kSectionName);
  if (mapping == nullptr) {
    CloseHandle(producer_mutex);
    return Result(env, false, "CreateFileMappingW failed.");
  }

  uint8_t* region = static_cast<uint8_t*>(MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, kTotalSize));
  if (region == nullptr) {
    CloseHandle(mapping);
    CloseHandle(producer_mutex);
    return Result(env, false, "MapViewOfFile failed.");
  }

  g_mapping = mapping;
  g_producer_mutex = producer_mutex;
  g_region = region;
  g_write_index = 0;
  std::memset(g_region, 0, kTotalSize);
  SetU32(0x0c, kFirstSlotOffset);
  SetU32(0x10, 0xBDD880);
  SetU32(0x14, 0x17BB0A0);
  SetU32(0x18, 0);
  SetU32(0x1c, kWidth);
  SetU32(0x20, kHeight);
  SetU64(0x28, fps == 60 ? 166666ULL : 333333ULL);
  SetU32(0x08, kStateStarting);
  return Result(env, true);
}

napi_value WriteFrame(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (g_region == nullptr) return Error(env, "OpticX Cam is not started.");
  if (argc != 2) return Error(env, "writeFrame requires an NV12 frame and timestamp.");

  napi_typedarray_type type;
  size_t length;
  void* data;
  napi_value array_buffer;
  size_t byte_offset;
  if (napi_get_typedarray_info(env, args[0], &type, &length, &data, &array_buffer, &byte_offset) != napi_ok ||
      type != napi_uint8_array || length != kFrameBytes) {
    return Error(env, "OpticX Cam requires a 3840x2160 NV12 Uint8Array.");
  }

  uint64_t timestamp;
  bool lossless;
  if (napi_get_value_bigint_uint64(env, args[1], &timestamp, &lossless) != napi_ok || !lossless) {
    return Error(env, "OpticX Cam timestamp must be an unsigned 64-bit BigInt.");
  }

  const uint32_t next = ++g_write_index;
  const uint32_t slot = next % kSlotCount;
  const size_t slot_offset = kFirstSlotOffset + slot * (kFrameHeaderSize + kFrameBytes);
  SetU32(0x00, next);
  SetU64(slot_offset, timestamp);
  std::memcpy(g_region + slot_offset + kFrameHeaderSize, data, kFrameBytes);
  SetU32(0x04, next);
  SetU32(0x08, kStateReady);

  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value Stop(napi_env env, napi_callback_info) {
  StopWriter();
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  return undefined;
}

napi_value Active(napi_env env, napi_callback_info) {
  napi_value active;
  napi_get_boolean(env, g_region != nullptr, &active);
  return active;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"start", nullptr, Start, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"writeFrame", nullptr, WriteFrame, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"stop", nullptr, Stop, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"active", nullptr, Active, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
