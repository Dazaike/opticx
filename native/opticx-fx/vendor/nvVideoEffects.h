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

#ifndef __NVVIDEO_EFFECTS_H__
#define __NVVIDEO_EFFECTS_H__

#include "nvCVImage.h"

#ifndef NvVFX_API
#ifdef _WIN32
#ifdef NVVFX_API_EXPORT
#define NvVFX_API __declspec(dllexport) __cdecl
#else
#define NvVFX_API
#endif
#else
#define NvVFX_API
#endif
#endif

#ifdef __cplusplus
extern "C" {
#endif

#ifndef _CUDA_TYPES_H_
typedef struct CUstream_st* CUstream;
#endif

typedef const char* NvVFX_EffectSelector;
typedef const char* NvVFX_ParameterSelector;

struct NvVFX_Object;
typedef struct NvVFX_Object NvVFX_Object, *NvVFX_Handle;
typedef void* NvVFX_StateObjectHandle;

NvCV_Status NvVFX_API NvVFX_GetVersion(unsigned int* version);
NvCV_Status NvVFX_API NvVFX_CreateEffect(NvVFX_EffectSelector code, NvVFX_Handle* effect);
void NvVFX_API NvVFX_DestroyEffect(NvVFX_Handle effect);

NvCV_Status NvVFX_API NvVFX_SetU32(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, unsigned int val);
NvCV_Status NvVFX_API NvVFX_SetS32(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, int val);
NvCV_Status NvVFX_API NvVFX_SetF32(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, float val);
NvCV_Status NvVFX_API NvVFX_SetF64(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, double val);
NvCV_Status NvVFX_API NvVFX_SetU64(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, unsigned long long val);
NvCV_Status NvVFX_API NvVFX_SetObject(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, void* ptr);
NvCV_Status NvVFX_API NvVFX_SetCudaStream(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, CUstream stream);
NvCV_Status NvVFX_API NvVFX_SetImage(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, NvCVImage* im);
NvCV_Status NvVFX_API NvVFX_SetString(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, const char* str);
NvCV_Status NvVFX_API NvVFX_SetStateObjectHandleArray(NvVFX_Handle effect, NvVFX_ParameterSelector paramName,
                                                      NvVFX_StateObjectHandle* handle);

NvCV_Status NvVFX_API NvVFX_GetU32(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, unsigned int* val);
NvCV_Status NvVFX_API NvVFX_GetS32(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, int* val);
NvCV_Status NvVFX_API NvVFX_GetF32(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, float* val);
NvCV_Status NvVFX_API NvVFX_GetF64(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, double* val);
NvCV_Status NvVFX_API NvVFX_GetU64(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, unsigned long long* val);
NvCV_Status NvVFX_API NvVFX_GetObject(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, void** ptr);
NvCV_Status NvVFX_API NvVFX_GetCudaStream(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, CUstream* stream);
NvCV_Status NvVFX_API NvVFX_GetImage(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, NvCVImage* im);
NvCV_Status NvVFX_API NvVFX_GetString(NvVFX_Handle effect, NvVFX_ParameterSelector paramName, const char** str);

NvCV_Status NvVFX_API NvVFX_Run(NvVFX_Handle effect, int async);
NvCV_Status NvVFX_API NvVFX_Load(NvVFX_Handle effect);

NvCV_Status NvVFX_API NvVFX_CudaStreamCreate(CUstream* stream);
NvCV_Status NvVFX_API NvVFX_CudaStreamDestroy(CUstream stream);

NvCV_Status NvVFX_API NvVFX_AllocateState(NvVFX_Handle effect, NvVFX_StateObjectHandle* handle);
NvCV_Status NvVFX_API NvVFX_DeallocateState(NvVFX_Handle effect, NvVFX_StateObjectHandle handle);
NvCV_Status NvVFX_API NvVFX_ResetState(NvVFX_Handle effect, NvVFX_StateObjectHandle handle);

#define NVVFX_FX_TRANSFER "Transfer"
#define NVVFX_FX_ARTIFACT_REDUCTION "ArtifactReduction"
#define NVVFX_FX_SUPER_RES "SuperRes"
#define NVVFX_FX_SR_UPSCALE "Upscale"
#define NVVFX_FX_DENOISING "Denoising"

#define NVVFX_INPUT_IMAGE_0 "SrcImage0"
#define NVVFX_INPUT_IMAGE NVVFX_INPUT_IMAGE_0
#define NVVFX_OUTPUT_IMAGE_0 "DstImage0"
#define NVVFX_OUTPUT_IMAGE NVVFX_OUTPUT_IMAGE_0
#define NVVFX_MODEL_DIRECTORY "ModelDir"
#define NVVFX_CUDA_STREAM "CudaStream"
#define NVVFX_INFO "Info"
#define NVVFX_SCALE "Scale"
#define NVVFX_STRENGTH "Strength"
#define NVVFX_MODE "Mode"
#define NVVFX_STATE "State"
#define NVVFX_TEMPORAL "Temporal"
#define NVVFX_GPU "GPU"

#ifdef __cplusplus
}
#endif

#endif
