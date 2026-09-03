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

#ifndef __NVCVIMAGE_H__
#define __NVCVIMAGE_H__

#include "nvCVStatus.h"

#ifdef __cplusplus
extern "C" {
#endif

struct CUstream_st;

typedef enum NvCVImage_PixelFormat {
  NVCV_FORMAT_UNKNOWN = 0,
  NVCV_Y = 1,
  NVCV_A = 2,
  NVCV_YA = 3,
  NVCV_RGB = 4,
  NVCV_BGR = 5,
  NVCV_RGBA = 6,
  NVCV_BGRA = 7,
  NVCV_YUV420 = 8,
  NVCV_YUV422 = 9
} NvCVImage_PixelFormat;

typedef enum NvCVImage_ComponentType {
  NVCV_TYPE_UNKNOWN = 0,
  NVCV_U8 = 1,
  NVCV_U16 = 2,
  NVCV_S16 = 3,
  NVCV_F16 = 4,
  NVCV_U32 = 5,
  NVCV_S32 = 6,
  NVCV_F32 = 7,
  NVCV_U64 = 8,
  NVCV_S64 = 9,
  NVCV_F64 = 10
} NvCVImage_ComponentType;

#define NVCV_INTERLEAVED 0
#define NVCV_CHUNKY 0
#define NVCV_PLANAR 1

#define NVCV_CPU 0
#define NVCV_GPU 1
#define NVCV_CUDA 1
#define NVCV_CPU_PINNED 2

typedef struct
#ifdef _MSC_VER
    __declspec(dllexport)
#endif
        NvCVImage {
  unsigned int width;
  unsigned int height;
  signed int pitch;
  NvCVImage_PixelFormat pixelFormat;
  NvCVImage_ComponentType componentType;
  unsigned char pixelBytes;
  unsigned char componentBytes;
  unsigned char numComponents;
  unsigned char planar;
  unsigned char gpuMem;
  unsigned char colorspace;
  unsigned char reserved[2];
  void* pixels;
  void* deletePtr;
  void (*deleteProc)(void* p);
  unsigned long long bufferBytes;
} NvCVImage;

NvCV_Status NvCV_API NvCVImage_Init(NvCVImage* im, unsigned width, unsigned height, int pitch, void* pixels,
                                    NvCVImage_PixelFormat format, NvCVImage_ComponentType type, unsigned layout,
                                    unsigned memSpace);

void NvCV_API NvCVImage_InitView(NvCVImage* subImg, NvCVImage* fullImg, int x, int y, unsigned width, unsigned height);

NvCV_Status NvCV_API NvCVImage_Alloc(NvCVImage* im, unsigned width, unsigned height, NvCVImage_PixelFormat format,
                                     NvCVImage_ComponentType type, unsigned layout, unsigned memSpace,
                                     unsigned alignment);

NvCV_Status NvCV_API NvCVImage_Realloc(NvCVImage* im, unsigned width, unsigned height, NvCVImage_PixelFormat format,
                                       NvCVImage_ComponentType type, unsigned layout, unsigned memSpace,
                                       unsigned alignment);

void NvCV_API NvCVImage_Dealloc(NvCVImage* im);

NvCV_Status NvCV_API NvCVImage_Create(unsigned width, unsigned height, NvCVImage_PixelFormat format,
                                      NvCVImage_ComponentType type, unsigned layout, unsigned memSpace,
                                      unsigned alignment, NvCVImage** out);

void NvCV_API NvCVImage_Destroy(NvCVImage* im);

NvCV_Status NvCV_API NvCVImage_Transfer(const NvCVImage* src, NvCVImage* dst, float scale, struct CUstream_st* stream,
                                        NvCVImage* tmp);

#ifdef __cplusplus
}
#endif

#endif
