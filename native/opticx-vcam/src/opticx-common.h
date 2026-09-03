// OpticX Cam - shared declarations for the DirectShow virtual camera filter.
//
// The Windows 10/11 SDK does not ship the DirectShow BaseClasses (strmbase),
// so every COM interface used here is implemented from scratch.

#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <windows.h>
#include <dshow.h>
#include <ks.h>

#include <cstdint>
#include <cstdlib>
#include <new>

// ---------------------------------------------------------------------------
// Producer geometry and advertised capture formats.
// ---------------------------------------------------------------------------

// Shared memory always carries one processed 4K NV12 frame. The DirectShow
// pin scales and converts that frame to the format negotiated by its client.
constexpr uint32_t kVCamWidth = 3840;
constexpr uint32_t kVCamHeight = 2160;
constexpr uint32_t kVCamFrameSize = kVCamWidth * kVCamHeight * 3 / 2;

constexpr int64_t kVCamInterval30 = 333333;
constexpr int64_t kVCamInterval60 = 166666;

enum class VCamPixelFormat {
	NV12,
	I420,
	YUY2,
};

struct VCamMediaSpec {
	uint32_t width;
	uint32_t height;
	int64_t interval;
	VCamPixelFormat format;
};

inline constexpr GUID kMediaSubtypeI420 = {
	MAKEFOURCC('I', '4', '2', '0'),
	0x0000,
	0x0010,
	{0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71},
};

// I420 first at the common resolutions: Chromium and Discord prefer a planar
// capture type. NV12 remains available for OBS and 4K-native consumers.
constexpr VCamMediaSpec kVCamMediaSpecs[] = {
	{1920, 1080, kVCamInterval30, VCamPixelFormat::I420},
	{1920, 1080, kVCamInterval60, VCamPixelFormat::I420},
	{1280, 720, kVCamInterval30, VCamPixelFormat::I420},
	{1280, 720, kVCamInterval60, VCamPixelFormat::I420},
	{640, 480, kVCamInterval30, VCamPixelFormat::I420},
	{640, 480, kVCamInterval60, VCamPixelFormat::I420},
	{3840, 2160, kVCamInterval30, VCamPixelFormat::NV12},
	{3840, 2160, kVCamInterval60, VCamPixelFormat::NV12},
	{1920, 1080, kVCamInterval30, VCamPixelFormat::NV12},
	{1920, 1080, kVCamInterval60, VCamPixelFormat::NV12},
	{1280, 720, kVCamInterval30, VCamPixelFormat::NV12},
	{1280, 720, kVCamInterval60, VCamPixelFormat::NV12},
	{640, 480, kVCamInterval30, VCamPixelFormat::NV12},
	{640, 480, kVCamInterval60, VCamPixelFormat::NV12},
	{1920, 1080, kVCamInterval30, VCamPixelFormat::YUY2},
	{1920, 1080, kVCamInterval60, VCamPixelFormat::YUY2},
	{1280, 720, kVCamInterval30, VCamPixelFormat::YUY2},
	{1280, 720, kVCamInterval60, VCamPixelFormat::YUY2},
	{640, 480, kVCamInterval30, VCamPixelFormat::YUY2},
	{640, 480, kVCamInterval60, VCamPixelFormat::YUY2},
};
constexpr int kVCamMediaTypeCount = ARRAYSIZE(kVCamMediaSpecs);

inline bool IsSupportedVCamInterval(int64_t interval)
{
	return interval == kVCamInterval30 || interval == kVCamInterval60;
}

inline uint32_t VCamOutputFrameSize(const VCamMediaSpec &spec)
{
	return spec.format == VCamPixelFormat::YUY2 ? spec.width * spec.height * 2
						     : spec.width * spec.height * 3 / 2;
}

// NV12 black in BT.601 limited range.
constexpr uint8_t kBlackLuma = 0x10;
constexpr uint8_t kBlackChroma = 0x80;

// Filter identity.
extern const GUID CLSID_OpticXVCam;
#define OPTICX_FILTER_NAME L"OpticX Cam"
#define OPTICX_PIN_ID L"OpticX Video Out"
#define OPTICX_PIN_NAME L"Video Output"

// Module-wide state owned by module.cpp.
extern HINSTANCE g_dllInstance;
void OpticXLockModule();
void OpticXUnlockModule();

// ---------------------------------------------------------------------------
// AM_MEDIA_TYPE helpers (normally supplied by strmbase).
// ---------------------------------------------------------------------------

void FreeMediaTypeContents(AM_MEDIA_TYPE *mt);
void DeleteMediaType(AM_MEDIA_TYPE *mt);
HRESULT CopyMediaTypeTo(AM_MEDIA_TYPE *dst, const AM_MEDIA_TYPE *src);
AM_MEDIA_TYPE *DuplicateMediaType(const AM_MEDIA_TYPE *src);

// Builds one advertised media type. `mt` is fully overwritten and its
// VIDEOINFOHEADER block is allocated with CoTaskMemAlloc.
HRESULT InitVCamMediaType(AM_MEDIA_TYPE *mt, const VCamMediaSpec &spec);

// Finds the advertised type satisfying a full or partial media type. Returns
// -1 when no type is compatible.
int FindVCamMediaType(const AM_MEDIA_TYPE *mt);
