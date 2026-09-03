/*###############################################################################
#
# Copyright (c) 2020 NVIDIA Corporation
#
# Permission is hereby granted, free of charge, to any person obtaining a copy of
# this software and associated documentation files (the "Software"), to deal in
# the Software without restriction, including without limitation the rights to
# use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
# the Software, and to permit persons to whom the Software is furnished to do so,
# subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
# FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
# COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
# IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
# CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
#
###############################################################################*/

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include "nvVideoEffects.h"
#include "maxine-runtime.h"

#include <windows.h>

#include <cstdio>
#include <mutex>

namespace {

wchar_t g_runtimeDir[MAX_PATH] = {};
HMODULE g_vfx = nullptr;
HMODULE g_cv = nullptr;
std::once_flag g_once;

bool FillRuntimeDir() {
  wchar_t pf[MAX_PATH];
  const DWORD n = GetEnvironmentVariableW(L"ProgramFiles", pf, MAX_PATH);
  if (n == 0 || n >= MAX_PATH) return false;
  const int written =
      _snwprintf_s(g_runtimeDir, _TRUNCATE, L"%s\\NVIDIA Corporation\\NVIDIA Video Effects", pf);
  return written > 0;
}

void LoadRuntimeOnce() {
  if (!FillRuntimeDir()) return;
  const UINT previous = SetErrorMode(SEM_FAILCRITICALERRORS);
  SetDllDirectoryW(g_runtimeDir);
  g_cv = LoadLibraryW(L"NVCVImage.dll");
  g_vfx = LoadLibraryW(L"NVVideoEffects.dll");
  SetErrorMode(previous);
}

HMODULE VfxModule() {
  std::call_once(g_once, LoadRuntimeOnce);
  return g_vfx;
}

template <typename Fn>
Fn Proc(const char* name) {
  HMODULE mod = VfxModule();
  if (!mod) return nullptr;
  return reinterpret_cast<Fn>(GetProcAddress(mod, name));
}

}  // namespace

bool MaxineRuntimeLoaded() {
  std::call_once(g_once, LoadRuntimeOnce);
  return g_vfx != nullptr && g_cv != nullptr;
}

const wchar_t* MaxineRuntimeDirW() {
  std::call_once(g_once, LoadRuntimeOnce);
  return g_runtimeDir;
}

HMODULE MaxineCvModule() {
  std::call_once(g_once, LoadRuntimeOnce);
  return g_cv;
}

NvCV_Status NvVFX_API NvVFX_GetVersion(unsigned int* version) {
  using Fn = decltype(NvVFX_GetVersion)*;
  const auto fn = Proc<Fn>("NvVFX_GetVersion");
  return fn ? fn(version) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_CreateEffect(NvVFX_EffectSelector code, NvVFX_Handle* effect) {
  using Fn = decltype(NvVFX_CreateEffect)*;
  const auto fn = Proc<Fn>("NvVFX_CreateEffect");
  return fn ? fn(code, effect) : NVCV_ERR_LIBRARY;
}

void NvVFX_API NvVFX_DestroyEffect(NvVFX_Handle effect) {
  using Fn = decltype(NvVFX_DestroyEffect)*;
  const auto fn = Proc<Fn>("NvVFX_DestroyEffect");
  if (fn) fn(effect);
}

NvCV_Status NvVFX_API NvVFX_SetU32(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, unsigned int val) {
  using Fn = decltype(NvVFX_SetU32)*;
  const auto fn = Proc<Fn>("NvVFX_SetU32");
  return fn ? fn(effect, paramName, val) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_SetS32(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, int val) {
  using Fn = decltype(NvVFX_SetS32)*;
  const auto fn = Proc<Fn>("NvVFX_SetS32");
  return fn ? fn(effect, paramName, val) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_SetF32(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, float val) {
  using Fn = decltype(NvVFX_SetF32)*;
  const auto fn = Proc<Fn>("NvVFX_SetF32");
  return fn ? fn(effect, paramName, val) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_SetF64(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, double val) {
  using Fn = decltype(NvVFX_SetF64)*;
  const auto fn = Proc<Fn>("NvVFX_SetF64");
  return fn ? fn(effect, paramName, val) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_SetU64(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, unsigned long long val) {
  using Fn = decltype(NvVFX_SetU64)*;
  const auto fn = Proc<Fn>("NvVFX_SetU64");
  return fn ? fn(effect, paramName, val) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_SetObject(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, void* ptr) {
  using Fn = decltype(NvVFX_SetObject)*;
  const auto fn = Proc<Fn>("NvVFX_SetObject");
  return fn ? fn(effect, paramName, ptr) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_SetCudaStream(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, CUstream stream) {
  using Fn = decltype(NvVFX_SetCudaStream)*;
  const auto fn = Proc<Fn>("NvVFX_SetCudaStream");
  return fn ? fn(effect, paramName, stream) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_SetImage(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, NvCVImage* im) {
  using Fn = decltype(NvVFX_SetImage)*;
  const auto fn = Proc<Fn>("NvVFX_SetImage");
  return fn ? fn(effect, paramName, im) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_SetString(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, const char* str) {
  using Fn = decltype(NvVFX_SetString)*;
  const auto fn = Proc<Fn>("NvVFX_SetString");
  return fn ? fn(effect, paramName, str) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_SetStateObjectHandleArray(NvVFX_Handle effect, NvVFX_ParameterSelector paramName,
                                                      NvVFX_StateObjectHandle* handle) {
  using Fn = decltype(NvVFX_SetStateObjectHandleArray)*;
  const auto fn = Proc<Fn>("NvVFX_SetStateObjectHandleArray");
  return fn ? fn(effect, paramName, handle) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_GetU32(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, unsigned int* val) {
  using Fn = decltype(NvVFX_GetU32)*;
  const auto fn = Proc<Fn>("NvVFX_GetU32");
  return fn ? fn(effect, paramName, val) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_GetS32(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, int* val) {
  using Fn = decltype(NvVFX_GetS32)*;
  const auto fn = Proc<Fn>("NvVFX_GetS32");
  return fn ? fn(effect, paramName, val) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_GetF32(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, float* val) {
  using Fn = decltype(NvVFX_GetF32)*;
  const auto fn = Proc<Fn>("NvVFX_GetF32");
  return fn ? fn(effect, paramName, val) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_GetF64(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, double* val) {
  using Fn = decltype(NvVFX_GetF64)*;
  const auto fn = Proc<Fn>("NvVFX_GetF64");
  return fn ? fn(effect, paramName, val) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_GetU64(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, unsigned long long* val) {
  using Fn = decltype(NvVFX_GetU64)*;
  const auto fn = Proc<Fn>("NvVFX_GetU64");
  return fn ? fn(effect, paramName, val) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_GetObject(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, void** ptr) {
  using Fn = decltype(NvVFX_GetObject)*;
  const auto fn = Proc<Fn>("NvVFX_GetObject");
  return fn ? fn(effect, paramName, ptr) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_GetCudaStream(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, CUstream* stream) {
  using Fn = decltype(NvVFX_GetCudaStream)*;
  const auto fn = Proc<Fn>("NvVFX_GetCudaStream");
  return fn ? fn(effect, paramName, stream) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_GetImage(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, NvCVImage* im) {
  using Fn = decltype(NvVFX_GetImage)*;
  const auto fn = Proc<Fn>("NvVFX_GetImage");
  return fn ? fn(effect, paramName, im) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_GetString(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, const char** str) {
  using Fn = decltype(NvVFX_GetString)*;
  const auto fn = Proc<Fn>("NvVFX_GetString");
  return fn ? fn(effect, paramName, str) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_Run(NvVFX_Handle effect, int async) {
  using Fn = decltype(NvVFX_Run)*;
  const auto fn = Proc<Fn>("NvVFX_Run");
  return fn ? fn(effect, async) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_Load(NvVFX_Handle effect) {
  using Fn = decltype(NvVFX_Load)*;
  const auto fn = Proc<Fn>("NvVFX_Load");
  return fn ? fn(effect) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_CudaStreamCreate(CUstream* stream) {
  using Fn = decltype(NvVFX_CudaStreamCreate)*;
  const auto fn = Proc<Fn>("NvVFX_CudaStreamCreate");
  return fn ? fn(stream) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_CudaStreamDestroy(CUstream stream) {
  using Fn = decltype(NvVFX_CudaStreamDestroy)*;
  const auto fn = Proc<Fn>("NvVFX_CudaStreamDestroy");
  return fn ? fn(stream) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_AllocateState(NvVFX_Handle effect, NvVFX_StateObjectHandle* handle) {
  using Fn = decltype(NvVFX_AllocateState)*;
  const auto fn = Proc<Fn>("NvVFX_AllocateState");
  return fn ? fn(effect, handle) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_DeallocateState(NvVFX_Handle effect, NvVFX_StateObjectHandle handle) {
  using Fn = decltype(NvVFX_DeallocateState)*;
  const auto fn = Proc<Fn>("NvVFX_DeallocateState");
  return fn ? fn(effect, handle) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvVFX_API NvVFX_ResetState(NvVFX_Handle effect, NvVFX_StateObjectHandle handle) {
  using Fn = decltype(NvVFX_ResetState)*;
  const auto fn = Proc<Fn>("NvVFX_ResetState");
  return fn ? fn(effect, handle) : NVCV_ERR_LIBRARY;
}
