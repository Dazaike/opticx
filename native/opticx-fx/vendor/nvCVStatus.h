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

#ifndef __NVCVSTATUS_H__
#define __NVCVSTATUS_H__

#ifndef NvCV_API
#ifdef _WIN32
#ifdef NVCV_API_EXPORT
#define NvCV_API __declspec(dllexport) __cdecl
#else
#define NvCV_API
#endif
#else
#define NvCV_API
#endif
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef enum NvCV_Status {
  NVCV_SUCCESS = 0,
  NVCV_ERR_GENERAL = -1,
  NVCV_ERR_UNIMPLEMENTED = -2,
  NVCV_ERR_MEMORY = -3,
  NVCV_ERR_EFFECT = -4,
  NVCV_ERR_SELECTOR = -5,
  NVCV_ERR_BUFFER = -6,
  NVCV_ERR_PARAMETER = -7,
  NVCV_ERR_MISMATCH = -8,
  NVCV_ERR_PIXELFORMAT = -9,
  NVCV_ERR_MODEL = -10,
  NVCV_ERR_LIBRARY = -11,
  NVCV_ERR_INITIALIZATION = -12,
  NVCV_ERR_FILE = -13,
  NVCV_ERR_FEATURENOTFOUND = -14,
  NVCV_ERR_MISSINGINPUT = -15,
  NVCV_ERR_RESOLUTION = -16,
  NVCV_ERR_UNSUPPORTEDGPU = -17,
  NVCV_ERR_WRONGGPU = -18,
  NVCV_ERR_UNSUPPORTEDDRIVER = -19,
  NVCV_ERR_CUDA_MEMORY = -20,
  NVCV_ERR_CUDA_VALUE = -21,
  NVCV_ERR_CUDA_PITCH = -22,
  NVCV_ERR_CUDA_INIT = -23,
  NVCV_ERR_CUDA_LAUNCH = -24,
  NVCV_ERR_CUDA_KERNEL = -25,
  NVCV_ERR_CUDA_DRIVER = -26,
  NVCV_ERR_CUDA_UNSUPPORTED = -27,
  NVCV_ERR_CUDA_ILLEGAL_ADDRESS = -28,
  NVCV_ERR_CUDA = -30,
  NVCV_ERR_OBJECTNOTFOUND = -31
} NvCV_Status;

#ifdef _WIN32
__declspec(dllexport) const char* __cdecl
#else
const char*
#endif
NvCV_GetErrorStringFromCode(NvCV_Status code);

#ifdef __cplusplus
}
#endif

#endif
