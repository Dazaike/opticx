/*###############################################################################
#
# Copyright 2020 NVIDIA Corporation
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

#include "nvCVImage.h"
#include "maxine-runtime.h"

#include <windows.h>

namespace {

template <typename Fn>
Fn Proc(const char* name) {
  HMODULE mod = MaxineCvModule();
  if (!mod) return nullptr;
  return reinterpret_cast<Fn>(GetProcAddress(mod, name));
}

}  // namespace

NvCV_Status NvCV_API NvCVImage_Init(NvCVImage* im, unsigned width, unsigned height, int pitch, void* pixels,
                                    NvCVImage_PixelFormat format, NvCVImage_ComponentType type, unsigned layout,
                                    unsigned memSpace) {
  using Fn = decltype(NvCVImage_Init)*;
  const auto fn = Proc<Fn>("NvCVImage_Init");
  return fn ? fn(im, width, height, pitch, pixels, format, type, layout, memSpace) : NVCV_ERR_LIBRARY;
}

void NvCV_API NvCVImage_InitView(NvCVImage* subImg, NvCVImage* fullImg, int x, int y, unsigned width, unsigned height) {
  using Fn = decltype(NvCVImage_InitView)*;
  const auto fn = Proc<Fn>("NvCVImage_InitView");
  if (fn) fn(subImg, fullImg, x, y, width, height);
}

NvCV_Status NvCV_API NvCVImage_Alloc(NvCVImage* im, unsigned width, unsigned height, NvCVImage_PixelFormat format,
                                     NvCVImage_ComponentType type, unsigned layout, unsigned memSpace,
                                     unsigned alignment) {
  using Fn = decltype(NvCVImage_Alloc)*;
  const auto fn = Proc<Fn>("NvCVImage_Alloc");
  return fn ? fn(im, width, height, format, type, layout, memSpace, alignment) : NVCV_ERR_LIBRARY;
}

NvCV_Status NvCV_API NvCVImage_Realloc(NvCVImage* im, unsigned width, unsigned height, NvCVImage_PixelFormat format,
                                       NvCVImage_ComponentType type, unsigned layout, unsigned memSpace,
                                       unsigned alignment) {
  using Fn = decltype(NvCVImage_Realloc)*;
  const auto fn = Proc<Fn>("NvCVImage_Realloc");
  return fn ? fn(im, width, height, format, type, layout, memSpace, alignment) : NVCV_ERR_LIBRARY;
}

void NvCV_API NvCVImage_Dealloc(NvCVImage* im) {
  using Fn = decltype(NvCVImage_Dealloc)*;
  const auto fn = Proc<Fn>("NvCVImage_Dealloc");
  if (fn) fn(im);
}

NvCV_Status NvCV_API NvCVImage_Create(unsigned width, unsigned height, NvCVImage_PixelFormat format,
                                      NvCVImage_ComponentType type, unsigned layout, unsigned memSpace,
                                      unsigned alignment, NvCVImage** out) {
  using Fn = decltype(NvCVImage_Create)*;
  const auto fn = Proc<Fn>("NvCVImage_Create");
  return fn ? fn(width, height, format, type, layout, memSpace, alignment, out) : NVCV_ERR_LIBRARY;
}

void NvCV_API NvCVImage_Destroy(NvCVImage* im) {
  using Fn = decltype(NvCVImage_Destroy)*;
  const auto fn = Proc<Fn>("NvCVImage_Destroy");
  if (fn) fn(im);
}

NvCV_Status NvCV_API NvCVImage_Transfer(const NvCVImage* src, NvCVImage* dst, float scale, struct CUstream_st* stream,
                                        NvCVImage* tmp) {
  using Fn = decltype(NvCVImage_Transfer)*;
  const auto fn = Proc<Fn>("NvCVImage_Transfer");
  return fn ? fn(src, dst, scale, stream, tmp) : NVCV_ERR_LIBRARY;
}

const char* NvCV_GetErrorStringFromCode(NvCV_Status code) {
  using Fn = const char* (*)(NvCV_Status);
  const auto fn = Proc<Fn>("NvCV_GetErrorStringFromCode");
  if (fn) return fn(code);
  return "NVCV_ERR_LIBRARY";
}
