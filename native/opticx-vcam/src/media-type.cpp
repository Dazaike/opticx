#include "opticx-common.h"

void FreeMediaTypeContents(AM_MEDIA_TYPE *mt)
{
	if (!mt)
		return;

	if (mt->cbFormat && mt->pbFormat) {
		CoTaskMemFree(mt->pbFormat);
		mt->cbFormat = 0;
		mt->pbFormat = nullptr;
	}
	if (mt->pUnk) {
		mt->pUnk->Release();
		mt->pUnk = nullptr;
	}
}

void DeleteMediaType(AM_MEDIA_TYPE *mt)
{
	if (!mt)
		return;

	FreeMediaTypeContents(mt);
	CoTaskMemFree(mt);
}

HRESULT CopyMediaTypeTo(AM_MEDIA_TYPE *dst, const AM_MEDIA_TYPE *src)
{
	if (!dst || !src)
		return E_POINTER;

	*dst = *src;
	dst->pbFormat = nullptr;
	dst->pUnk = nullptr;

	if (src->cbFormat && src->pbFormat) {
		dst->pbFormat = (BYTE *)CoTaskMemAlloc(src->cbFormat);
		if (!dst->pbFormat) {
			dst->cbFormat = 0;
			return E_OUTOFMEMORY;
		}
		memcpy(dst->pbFormat, src->pbFormat, src->cbFormat);
	} else {
		dst->cbFormat = 0;
	}

	if (src->pUnk) {
		dst->pUnk = src->pUnk;
		dst->pUnk->AddRef();
	}

	return S_OK;
}

AM_MEDIA_TYPE *DuplicateMediaType(const AM_MEDIA_TYPE *src)
{
	if (!src)
		return nullptr;

	AM_MEDIA_TYPE *mt = (AM_MEDIA_TYPE *)CoTaskMemAlloc(sizeof(AM_MEDIA_TYPE));
	if (!mt)
		return nullptr;

	if (FAILED(CopyMediaTypeTo(mt, src))) {
		CoTaskMemFree(mt);
		return nullptr;
	}

	return mt;
}

namespace {

const GUID &SubtypeFor(VCamPixelFormat format)
{
	switch (format) {
	case VCamPixelFormat::I420:
		return kMediaSubtypeI420;
	case VCamPixelFormat::YUY2:
		return MEDIASUBTYPE_YUY2;
	default:
		return MEDIASUBTYPE_NV12;
	}
}

DWORD CompressionFor(VCamPixelFormat format)
{
	switch (format) {
	case VCamPixelFormat::I420:
		return MAKEFOURCC('I', '4', '2', '0');
	case VCamPixelFormat::YUY2:
		return MAKEFOURCC('Y', 'U', 'Y', '2');
	default:
		return MAKEFOURCC('N', 'V', '1', '2');
	}
}

WORD BitsPerPixel(VCamPixelFormat format)
{
	return format == VCamPixelFormat::YUY2 ? 16 : 12;
}

} // namespace

HRESULT InitVCamMediaType(AM_MEDIA_TYPE *mt, const VCamMediaSpec &spec)
{
	if (!mt)
		return E_POINTER;

	VIDEOINFOHEADER *vih = (VIDEOINFOHEADER *)CoTaskMemAlloc(sizeof(VIDEOINFOHEADER));
	if (!vih)
		return E_OUTOFMEMORY;

	memset(vih, 0, sizeof(*vih));
	memset(mt, 0, sizeof(*mt));

	vih->rcSource.right = (LONG)spec.width;
	vih->rcSource.bottom = (LONG)spec.height;
	vih->rcTarget = vih->rcSource;
	vih->AvgTimePerFrame = spec.interval;

	const uint32_t frameSize = VCamOutputFrameSize(spec);
	const uint64_t bitRate = (uint64_t)frameSize * 8ULL * 10000000ULL / (uint64_t)spec.interval;
	vih->dwBitRate = bitRate > MAXDWORD ? MAXDWORD : (DWORD)bitRate;

	vih->bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
	vih->bmiHeader.biWidth = (LONG)spec.width;
	vih->bmiHeader.biHeight = (LONG)spec.height;
	vih->bmiHeader.biPlanes = 1;
	vih->bmiHeader.biBitCount = BitsPerPixel(spec.format);
	vih->bmiHeader.biCompression = CompressionFor(spec.format);
	vih->bmiHeader.biSizeImage = frameSize;

	mt->majortype = MEDIATYPE_Video;
	mt->subtype = SubtypeFor(spec.format);
	mt->formattype = FORMAT_VideoInfo;
	mt->bFixedSizeSamples = TRUE;
	mt->bTemporalCompression = FALSE;
	mt->lSampleSize = frameSize;
	mt->cbFormat = sizeof(VIDEOINFOHEADER);
	mt->pbFormat = (BYTE *)vih;
	return S_OK;
}

int FindVCamMediaType(const AM_MEDIA_TYPE *mt)
{
	if (!mt)
		return 0;
	if (mt->majortype != GUID_NULL && mt->majortype != MEDIATYPE_Video)
		return -1;
	if (mt->formattype != GUID_NULL && mt->formattype != FORMAT_VideoInfo)
		return -1;

	const bool hasFormat = mt->pbFormat && mt->cbFormat >= sizeof(VIDEOINFOHEADER);
	const VIDEOINFOHEADER *vih = hasFormat ? (const VIDEOINFOHEADER *)mt->pbFormat : nullptr;

	for (int i = 0; i < kVCamMediaTypeCount; ++i) {
		const VCamMediaSpec &spec = kVCamMediaSpecs[i];
		if (mt->subtype != GUID_NULL && mt->subtype != SubtypeFor(spec.format))
			continue;
		if (vih) {
			if (vih->bmiHeader.biWidth != (LONG)spec.width ||
			    abs(vih->bmiHeader.biHeight) != (LONG)spec.height)
				continue;
			if (vih->AvgTimePerFrame && vih->AvgTimePerFrame != spec.interval)
				continue;
		}
		return i;
	}
	return -1;
}
