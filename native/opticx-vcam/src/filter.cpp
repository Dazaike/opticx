#include "filter.h"

#include <mmsystem.h>

namespace {

inline uint64_t QpcTo100ns(int64_t ticks, int64_t freq)
{
	// Split to keep full precision without overflowing 64 bits.
	const int64_t whole = ticks / freq;
	const int64_t rem = ticks % freq;
	return (uint64_t)whole * 10000000ULL + (uint64_t)((rem * 10000000LL) / freq);
}

} // namespace

// ===========================================================================
// OpticXPin
// ===========================================================================

OpticXPin::OpticXPin(OpticXFilter *filter) : m_filter(filter)
{
	InitializeCriticalSection(&m_lock);

	for (int i = 0; i < kVCamMediaTypeCount; i++)
		InitVCamMediaType(&m_mtList[i], kVCamMediaSpecs[i]);

	// Chromium/Discord-compatible I420 1080p30 is the default.
	CopyMediaTypeTo(&m_mt, &m_mtList[0]);
	m_mediaTypeIndex = 0;
	m_sourceFrame = new (std::nothrow) uint8_t[kVCamFrameSize];
	m_stopEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
}

OpticXPin::~OpticXPin()
{
	StopStreaming();
	ReleaseConnection();

	if (m_stopEvent)
		CloseHandle(m_stopEvent);

	FreeMediaTypeContents(&m_mt);
	for (int i = 0; i < kVCamMediaTypeCount; i++)
		FreeMediaTypeContents(&m_mtList[i]);
	delete[] m_sourceFrame;

	DeleteCriticalSection(&m_lock);
}

STDMETHODIMP OpticXPin::QueryInterface(REFIID riid, void **ppv)
{
	if (!ppv)
		return E_POINTER;

	if (riid == IID_IUnknown || riid == IID_IPin) {
		*ppv = static_cast<IPin *>(this);
	} else if (riid == IID_IAMStreamConfig) {
		*ppv = static_cast<IAMStreamConfig *>(this);
	} else if (riid == IID_IKsPropertySet) {
		*ppv = static_cast<IKsPropertySet *>(this);
	} else {
		*ppv = nullptr;
		return E_NOINTERFACE;
	}

	AddRef();
	return S_OK;
}

STDMETHODIMP_(ULONG) OpticXPin::AddRef()
{
	return (ULONG)InterlockedIncrement(&m_refCount);
}

STDMETHODIMP_(ULONG) OpticXPin::Release()
{
	const LONG refs = InterlockedDecrement(&m_refCount);
	if (refs == 0) {
		delete this;
		return 0;
	}
	return (ULONG)refs;
}

// Caller must hold m_lock.
void OpticXPin::SelectMediaType(int index)
{
	if (index < 0 || index >= kVCamMediaTypeCount || index == m_mediaTypeIndex)
		return;

	FreeMediaTypeContents(&m_mt);
	if (SUCCEEDED(CopyMediaTypeTo(&m_mt, &m_mtList[index])))
		m_mediaTypeIndex = index;
}

// --- IPin ------------------------------------------------------------------

STDMETHODIMP OpticXPin::Connect(IPin *pReceivePin, const AM_MEDIA_TYPE *pmt)
{
	if (!pReceivePin)
		return E_POINTER;

	if (m_filter->CurrentState() == State_Running)
		return VFW_E_NOT_STOPPED;

	const int requested = pmt ? FindVCamMediaType(pmt) : m_mediaTypeIndex;
	if (requested < 0)
		return VFW_E_TYPE_NOT_ACCEPTED;

	EnterCriticalSection(&m_lock);

	HRESULT hr;
	if (m_connected) {
		hr = VFW_E_ALREADY_CONNECTED;
	} else {
		// Honour the exact size, pixel format, and rate the peer requested.
		SelectMediaType(requested);

		hr = pReceivePin->ReceiveConnection(static_cast<IPin *>(this), &m_mt);
		if (SUCCEEDED(hr)) {
			if (AllocateBuffers(pReceivePin)) {
				m_connected = pReceivePin;
				m_connected->AddRef();
			} else {
				pReceivePin->Disconnect();
				ReleaseConnection();
				hr = VFW_E_NO_TRANSPORT;
			}
		}
	}

	LeaveCriticalSection(&m_lock);
	return hr;
}

STDMETHODIMP OpticXPin::ReceiveConnection(IPin *, const AM_MEDIA_TYPE *)
{
	// Output-only pin: nothing ever connects *to* us.
	return E_UNEXPECTED;
}

STDMETHODIMP OpticXPin::Disconnect()
{
	if (m_filter->CurrentState() != State_Stopped)
		return VFW_E_NOT_STOPPED;

	StopStreaming();

	EnterCriticalSection(&m_lock);
	const bool wasConnected = m_connected != nullptr;
	ReleaseConnection();
	LeaveCriticalSection(&m_lock);

	return wasConnected ? S_OK : S_FALSE;
}

STDMETHODIMP OpticXPin::ConnectedTo(IPin **pPin)
{
	if (!pPin)
		return E_POINTER;

	EnterCriticalSection(&m_lock);
	IPin *pin = m_connected;
	if (pin)
		pin->AddRef();
	LeaveCriticalSection(&m_lock);

	*pPin = pin;
	return pin ? S_OK : VFW_E_NOT_CONNECTED;
}

STDMETHODIMP OpticXPin::ConnectionMediaType(AM_MEDIA_TYPE *pmt)
{
	if (!pmt)
		return E_POINTER;

	EnterCriticalSection(&m_lock);
	const bool connected = m_connected != nullptr;
	HRESULT hr = connected ? CopyMediaTypeTo(pmt, &m_mt) : VFW_E_NOT_CONNECTED;
	LeaveCriticalSection(&m_lock);

	if (!connected)
		memset(pmt, 0, sizeof(*pmt));

	return hr;
}

STDMETHODIMP OpticXPin::QueryPinInfo(PIN_INFO *pInfo)
{
	if (!pInfo)
		return E_POINTER;

	pInfo->pFilter = static_cast<IBaseFilter *>(m_filter);
	pInfo->pFilter->AddRef();
	pInfo->dir = PINDIR_OUTPUT;
	wcscpy_s(pInfo->achName, OPTICX_PIN_NAME);
	return S_OK;
}

STDMETHODIMP OpticXPin::QueryDirection(PIN_DIRECTION *pPinDir)
{
	if (!pPinDir)
		return E_POINTER;

	*pPinDir = PINDIR_OUTPUT;
	return S_OK;
}

STDMETHODIMP OpticXPin::QueryId(LPWSTR *lpId)
{
	if (!lpId)
		return E_POINTER;

	wchar_t *id = (wchar_t *)CoTaskMemAlloc(sizeof(OPTICX_PIN_ID));
	if (!id)
		return E_OUTOFMEMORY;

	memcpy(id, OPTICX_PIN_ID, sizeof(OPTICX_PIN_ID));
	*lpId = id;
	return S_OK;
}

STDMETHODIMP OpticXPin::QueryAccept(const AM_MEDIA_TYPE *pmt)
{
	return FindVCamMediaType(pmt) >= 0 ? S_OK : S_FALSE;
}

STDMETHODIMP OpticXPin::EnumMediaTypes(IEnumMediaTypes **ppEnum)
{
	if (!ppEnum)
		return E_POINTER;

	*ppEnum = new (std::nothrow) OpticXEnumMediaTypes(this, 0);
	if (!*ppEnum)
		return E_OUTOFMEMORY;

	(*ppEnum)->AddRef();
	return S_OK;
}

STDMETHODIMP OpticXPin::QueryInternalConnections(IPin **, ULONG *)
{
	return E_NOTIMPL;
}

STDMETHODIMP OpticXPin::EndOfStream()
{
	// Input-pin method; meaningless on a source pin.
	return E_UNEXPECTED;
}

STDMETHODIMP OpticXPin::BeginFlush()
{
	InterlockedExchange(&m_flushing, 1);

	EnterCriticalSection(&m_lock);
	IPin *connected = m_connected;
	if (connected)
		connected->AddRef();
	LeaveCriticalSection(&m_lock);

	if (connected) {
		connected->BeginFlush();
		connected->Release();
	}

	return S_OK;
}

STDMETHODIMP OpticXPin::EndFlush()
{
	EnterCriticalSection(&m_lock);
	IPin *connected = m_connected;
	if (connected)
		connected->AddRef();
	LeaveCriticalSection(&m_lock);

	if (connected) {
		connected->EndFlush();
		connected->Release();
	}

	InterlockedExchange(&m_flushing, 0);
	return S_OK;
}

STDMETHODIMP OpticXPin::NewSegment(REFERENCE_TIME, REFERENCE_TIME, double)
{
	return S_OK;
}

// --- IAMStreamConfig -------------------------------------------------------

STDMETHODIMP OpticXPin::SetFormat(AM_MEDIA_TYPE *pmt)
{
	const int requested = FindVCamMediaType(pmt);
	if (requested < 0)
		return VFW_E_INVALIDMEDIATYPE;

	EnterCriticalSection(&m_lock);
	SelectMediaType(requested);
	LeaveCriticalSection(&m_lock);

	return S_OK;
}

STDMETHODIMP OpticXPin::GetFormat(AM_MEDIA_TYPE **ppmt)
{
	if (!ppmt)
		return E_POINTER;

	EnterCriticalSection(&m_lock);
	*ppmt = DuplicateMediaType(&m_mt);
	LeaveCriticalSection(&m_lock);

	return *ppmt ? S_OK : E_OUTOFMEMORY;
}

STDMETHODIMP OpticXPin::GetNumberOfCapabilities(int *piCount, int *piSize)
{
	if (!piCount || !piSize)
		return E_POINTER;

	*piCount = kVCamMediaTypeCount;
	*piSize = sizeof(VIDEO_STREAM_CONFIG_CAPS);
	return S_OK;
}

STDMETHODIMP OpticXPin::GetStreamCaps(int iIndex, AM_MEDIA_TYPE **ppmt, BYTE *pSCC)
{
	if (!ppmt || !pSCC)
		return E_POINTER;
	if (iIndex < 0)
		return E_INVALIDARG;
	if (iIndex >= kVCamMediaTypeCount)
		return S_FALSE;

	AM_MEDIA_TYPE *mt = DuplicateMediaType(&m_mtList[iIndex]);
	if (!mt)
		return E_OUTOFMEMORY;

	const VIDEOINFOHEADER *vih = (const VIDEOINFOHEADER *)mt->pbFormat;

	VIDEO_STREAM_CONFIG_CAPS caps = {};
	caps.guid = FORMAT_VideoInfo;
	caps.VideoStandard = 0;
	// Each stream-capability row describes one exact output contract.
	caps.MinFrameInterval = vih->AvgTimePerFrame;
	caps.MaxFrameInterval = vih->AvgTimePerFrame;
	caps.InputSize.cx = vih->bmiHeader.biWidth;
	caps.InputSize.cy = abs(vih->bmiHeader.biHeight);
	caps.MinOutputSize = caps.InputSize;
	caps.MaxOutputSize = caps.InputSize;
	caps.MinCroppingSize = caps.InputSize;
	caps.MaxCroppingSize = caps.InputSize;
	caps.CropGranularityX = 1;
	caps.CropGranularityY = 1;
	caps.OutputGranularityX = 1;
	caps.OutputGranularityY = 1;
	caps.MinBitsPerSecond = (LONG)vih->dwBitRate;
	caps.MaxBitsPerSecond = (LONG)vih->dwBitRate;

	*ppmt = mt;
	memcpy(pSCC, &caps, sizeof(caps));
	return S_OK;
}

// --- IKsPropertySet --------------------------------------------------------

STDMETHODIMP OpticXPin::Set(REFGUID, DWORD, void *, DWORD, void *, DWORD)
{
	return E_NOTIMPL;
}

STDMETHODIMP OpticXPin::Get(REFGUID guidPropSet, DWORD dwPropID, void *, DWORD, void *pPropData,
			    DWORD cbPropData, DWORD *pcbReturned)
{
	if (guidPropSet != AMPROPSETID_Pin)
		return E_PROP_SET_UNSUPPORTED;
	if (dwPropID != AMPROPERTY_PIN_CATEGORY)
		return E_PROP_ID_UNSUPPORTED;
	if (!pPropData && !pcbReturned)
		return E_POINTER;

	if (pcbReturned)
		*pcbReturned = sizeof(GUID);
	if (!pPropData)
		return S_OK;
	if (cbPropData < sizeof(GUID))
		return E_UNEXPECTED;

	*(GUID *)pPropData = PIN_CATEGORY_CAPTURE;
	return S_OK;
}

STDMETHODIMP OpticXPin::QuerySupported(REFGUID guidPropSet, DWORD dwPropID, DWORD *pTypeSupport)
{
	if (guidPropSet != AMPROPSETID_Pin)
		return E_PROP_SET_UNSUPPORTED;
	if (dwPropID != AMPROPERTY_PIN_CATEGORY)
		return E_PROP_ID_UNSUPPORTED;
	if (pTypeSupport)
		*pTypeSupport = KSPROPERTY_SUPPORT_GET;
	return S_OK;
}

// --- connection plumbing ---------------------------------------------------

// Caller must hold m_lock.
bool OpticXPin::AllocateBuffers(IPin *target)
{
	IMemInputPin *memInput = nullptr;
	if (FAILED(target->QueryInterface(IID_IMemInputPin, (void **)&memInput)) || !memInput)
		return false;

	IMemAllocator *allocator = nullptr;
	HRESULT hr = memInput->GetAllocator(&allocator);
	if (FAILED(hr) || !allocator) {
		allocator = nullptr;
		hr = CoCreateInstance(CLSID_MemoryAllocator, nullptr, CLSCTX_INPROC_SERVER, IID_IMemAllocator,
				      (void **)&allocator);
		if (FAILED(hr) || !allocator) {
			memInput->Release();
			return false;
		}
	}

	ALLOCATOR_PROPERTIES props = {};
	if (FAILED(memInput->GetAllocatorRequirements(&props)))
		props = {};

	if (props.cBuffers < 4)
		props.cBuffers = 4;
	if (props.cbAlign < 1)
		props.cbAlign = 32;
	if (props.cbPrefix < 0)
		props.cbPrefix = 0;
	const long frameSize = (long)VCamOutputFrameSize(kVCamMediaSpecs[m_mediaTypeIndex]);
	props.cbBuffer = frameSize;

	ALLOCATOR_PROPERTIES actual = {};
	if (FAILED(allocator->SetProperties(&props, &actual)) || actual.cbBuffer < frameSize) {
		allocator->Release();
		memInput->Release();
		return false;
	}

	if (FAILED(memInput->NotifyAllocator(allocator, FALSE))) {
		allocator->Release();
		memInput->Release();
		return false;
	}

	// Replace any previous connection state.
	if (m_allocator) {
		if (m_committed)
			m_allocator->Decommit();
		m_allocator->Release();
	}
	if (m_memInput)
		m_memInput->Release();

	m_allocator = allocator;
	m_memInput = memInput;
	m_committed = false;
	return true;
}

// Caller must hold m_lock.
void OpticXPin::ReleaseConnection()
{
	if (m_allocator) {
		if (m_committed)
			m_allocator->Decommit();
		m_allocator->Release();
		m_allocator = nullptr;
	}
	if (m_memInput) {
		m_memInput->Release();
		m_memInput = nullptr;
	}
	if (m_connected) {
		m_connected->Release();
		m_connected = nullptr;
	}
	m_committed = false;
}

HRESULT OpticXPin::CommitAllocator()
{
	EnterCriticalSection(&m_lock);

	HRESULT hr = S_OK;
	if (m_allocator && !m_committed) {
		hr = m_allocator->Commit();
		if (SUCCEEDED(hr))
			m_committed = true;
	}

	LeaveCriticalSection(&m_lock);
	return hr;
}

void OpticXPin::FlushDownstream()
{
	EnterCriticalSection(&m_lock);
	IPin *connected = m_connected;
	if (connected)
		connected->AddRef();
	LeaveCriticalSection(&m_lock);

	if (connected) {
		connected->BeginFlush();
		connected->EndFlush();
		connected->Release();
	}
}

// --- streaming -------------------------------------------------------------

HRESULT OpticXPin::StartStreaming()
{
	EnterCriticalSection(&m_lock);

	HRESULT hr = S_OK;
	if (m_thread) {
		// Already running.
	} else if (!m_connected || !m_memInput || !m_allocator) {
		hr = VFW_E_NOT_CONNECTED;
	} else if (!m_stopEvent) {
		hr = E_FAIL;
	} else {
		ResetEvent(m_stopEvent);
		AddRef(); // released by the thread when it exits
		m_thread = CreateThread(nullptr, 0, ThreadThunk, this, 0, nullptr);
		if (!m_thread) {
			Release();
			hr = HRESULT_FROM_WIN32(GetLastError());
		}
	}

	LeaveCriticalSection(&m_lock);
	return hr;
}

void OpticXPin::StopStreaming()
{
	// The handle is detached under the lock so that a concurrent Stop() or
	// the destructor cannot join the same thread twice.
	EnterCriticalSection(&m_lock);
	HANDLE thread = m_thread;
	m_thread = nullptr;
	LeaveCriticalSection(&m_lock);

	if (!thread)
		return;

	SetEvent(m_stopEvent);
	WaitForSingleObject(thread, 5000);
	CloseHandle(thread);
	ResetEvent(m_stopEvent);
}

DWORD WINAPI OpticXPin::ThreadThunk(LPVOID param)
{
	OpticXPin *pin = (OpticXPin *)param;
	pin->ThreadProc();
	pin->Release();
	return 0;
}

void OpticXPin::ConvertFrame(const uint8_t *source, uint8_t *destination, const VCamMediaSpec &spec)
{
	const uint32_t dstWidth = spec.width;
	const uint32_t dstHeight = spec.height;
	const uint8_t *sourceY = source;
	const uint8_t *sourceUV = source + (size_t)kVCamWidth * kVCamHeight;

	if (spec.format == VCamPixelFormat::NV12 && dstWidth == kVCamWidth && dstHeight == kVCamHeight) {
		memcpy(destination, source, kVCamFrameSize);
		return;
	}

	if (spec.format == VCamPixelFormat::YUY2) {
		for (uint32_t y = 0; y < dstHeight; ++y) {
			const uint32_t sourceRow = y * kVCamHeight / dstHeight;
			uint8_t *row = destination + (size_t)y * dstWidth * 2;
			for (uint32_t x = 0; x < dstWidth; x += 2) {
				const uint32_t sx0 = x * kVCamWidth / dstWidth;
				const uint32_t sx1 = (x + 1) * kVCamWidth / dstWidth;
				const uint32_t chromaX = (x / 2) * (kVCamWidth / 2) / (dstWidth / 2);
				const size_t chroma = (size_t)(sourceRow / 2) * kVCamWidth + chromaX * 2;
				row[x * 2 + 0] = sourceY[(size_t)sourceRow * kVCamWidth + sx0];
				row[x * 2 + 1] = sourceUV[chroma + 0];
				row[x * 2 + 2] = sourceY[(size_t)sourceRow * kVCamWidth + sx1];
				row[x * 2 + 3] = sourceUV[chroma + 1];
			}
		}
		return;
	}

	const size_t dstLumaSize = (size_t)dstWidth * dstHeight;
	for (uint32_t y = 0; y < dstHeight; ++y) {
		const uint32_t sourceRow = y * kVCamHeight / dstHeight;
		uint8_t *row = destination + (size_t)y * dstWidth;
		for (uint32_t x = 0; x < dstWidth; ++x)
			row[x] = sourceY[(size_t)sourceRow * kVCamWidth + x * kVCamWidth / dstWidth];
	}

	if (spec.format == VCamPixelFormat::NV12) {
		uint8_t *dstUV = destination + dstLumaSize;
		for (uint32_t y = 0; y < dstHeight / 2; ++y) {
			const uint32_t sourceRow = y * (kVCamHeight / 2) / (dstHeight / 2);
			for (uint32_t x = 0; x < dstWidth / 2; ++x) {
				const uint32_t sourceCol = x * (kVCamWidth / 2) / (dstWidth / 2);
				const size_t sourceOffset = (size_t)sourceRow * kVCamWidth + sourceCol * 2;
				const size_t dstOffset = (size_t)y * dstWidth + x * 2;
				dstUV[dstOffset + 0] = sourceUV[sourceOffset + 0];
				dstUV[dstOffset + 1] = sourceUV[sourceOffset + 1];
			}
		}
		return;
	}

	uint8_t *dstU = destination + dstLumaSize;
	uint8_t *dstV = dstU + dstLumaSize / 4;
	for (uint32_t y = 0; y < dstHeight / 2; ++y) {
		const uint32_t sourceRow = y * (kVCamHeight / 2) / (dstHeight / 2);
		for (uint32_t x = 0; x < dstWidth / 2; ++x) {
			const uint32_t sourceCol = x * (kVCamWidth / 2) / (dstWidth / 2);
			const size_t sourceOffset = (size_t)sourceRow * kVCamWidth + sourceCol * 2;
			const size_t dstOffset = (size_t)y * (dstWidth / 2) + x;
			dstU[dstOffset] = sourceUV[sourceOffset + 0];
			dstV[dstOffset] = sourceUV[sourceOffset + 1];
		}
	}
}

HRESULT OpticXPin::DeliverFrame(IMemInputPin *memInput, IMemAllocator *allocator, REFERENCE_TIME start,
				REFERENCE_TIME stop, bool first)
{
	IMediaSample *sample = nullptr;
	HRESULT hr = allocator->GetBuffer(&sample, nullptr, nullptr, 0);
	if (FAILED(hr) || !sample)
		return FAILED(hr) ? hr : E_FAIL;

	BYTE *ptr = nullptr;
	const VCamMediaSpec &spec = kVCamMediaSpecs[m_mediaTypeIndex];
	const long outputSize = (long)VCamOutputFrameSize(spec);
	if (m_sourceFrame && SUCCEEDED(sample->GetPointer(&ptr)) && ptr && sample->GetSize() >= outputSize) {
		m_reader.ReadFrame(m_sourceFrame);
		ConvertFrame(m_sourceFrame, ptr, spec);

		sample->SetActualDataLength(outputSize);
		sample->SetSyncPoint(TRUE);
		sample->SetPreroll(FALSE);
		sample->SetDiscontinuity(first ? TRUE : FALSE);
		sample->SetTime(&start, &stop);
		sample->SetMediaTime(&start, &stop);

		hr = InterlockedCompareExchange(&m_flushing, 0, 0) ? S_FALSE : memInput->Receive(sample);
	} else {
		hr = E_FAIL;
	}

	sample->Release();
	return hr;
}

void OpticXPin::ThreadProc()
{
	// Snapshot the connection so the streaming loop never touches m_lock,
	// which keeps Stop() free of any chance of a join deadlock.
	EnterCriticalSection(&m_lock);
	IMemInputPin *memInput = m_memInput;
	IMemAllocator *allocator = m_allocator;
	if (memInput)
		memInput->AddRef();
	if (allocator)
		allocator->AddRef();
	const uint64_t negotiated = (uint64_t)kVCamMediaSpecs[m_mediaTypeIndex].interval;
	LeaveCriticalSection(&m_lock);

	if (!memInput || !allocator) {
		if (memInput)
			memInput->Release();
		if (allocator)
			allocator->Release();
		return;
	}

	CoInitializeEx(nullptr, COINIT_MULTITHREADED);
	timeBeginPeriod(1);
	SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL);

	LARGE_INTEGER freq = {};
	LARGE_INTEGER origin = {};
	QueryPerformanceFrequency(&freq);
	QueryPerformanceCounter(&origin);

	REFERENCE_TIME sampleStart = 0;
	uint64_t deadline = 0;
	// The producer's advertised rate is only known after the first read, so
	// the first frame is paced at the negotiated rate.
	uint64_t interval = negotiated;
	bool first = true;

	while (WaitForSingleObject(m_stopEvent, 0) == WAIT_TIMEOUT) {
		const HRESULT hr = DeliverFrame(memInput, allocator, sampleStart,
						sampleStart + (REFERENCE_TIME)interval, first);
		if (hr == S_OK)
			first = false;
		else if (hr != S_FALSE && hr != VFW_E_TIMEOUT)
			break; // downstream is gone or wedged

		sampleStart += (REFERENCE_TIME)interval;
		deadline += interval;

		// Follow the producer's frame interval when it advertises one we
		// support, but never push faster than the negotiated rate.
		const uint64_t queueInterval = m_reader.QueueInterval();
		interval = negotiated;
		if (IsSupportedVCamInterval((int64_t)queueInterval) && queueInterval > negotiated)
			interval = queueInterval;

		// Pace to the next deadline, resynchronising if we ever fall
		// more than a second behind.
		for (;;) {
			LARGE_INTEGER now = {};
			QueryPerformanceCounter(&now);
			const uint64_t elapsed = QpcTo100ns(now.QuadPart - origin.QuadPart, freq.QuadPart);

			if (elapsed >= deadline) {
				if (elapsed - deadline > 10000000ULL)
					deadline = elapsed;
				break;
			}

			DWORD waitMs = (DWORD)((deadline - elapsed) / 10000ULL);
			if (waitMs == 0)
				waitMs = 1;
			if (WaitForSingleObject(m_stopEvent, waitMs) == WAIT_OBJECT_0)
				goto done;
		}
	}

done:
	m_reader.Close();
	timeEndPeriod(1);
	CoUninitialize();

	memInput->Release();
	allocator->Release();
}

// ===========================================================================
// OpticXFilter
// ===========================================================================

OpticXFilter::OpticXFilter()
{
	InitializeCriticalSection(&m_lock);
	OpticXLockModule();

	m_pin = new (std::nothrow) OpticXPin(this);
	if (m_pin)
		m_pin->AddRef();
}

OpticXFilter::~OpticXFilter()
{
	if (m_pin) {
		m_pin->StopStreaming();
		m_pin->Release();
		m_pin = nullptr;
	}
	if (m_clock) {
		m_clock->Release();
		m_clock = nullptr;
	}

	DeleteCriticalSection(&m_lock);
	OpticXUnlockModule();
}

FILTER_STATE OpticXFilter::CurrentState()
{
	EnterCriticalSection(&m_lock);
	const FILTER_STATE state = m_state;
	LeaveCriticalSection(&m_lock);
	return state;
}

STDMETHODIMP OpticXFilter::QueryInterface(REFIID riid, void **ppv)
{
	if (!ppv)
		return E_POINTER;

	if (riid == IID_IUnknown || riid == IID_IPersist || riid == IID_IMediaFilter || riid == IID_IBaseFilter) {
		*ppv = static_cast<IBaseFilter *>(this);
	} else if (riid == IID_IAMFilterMiscFlags) {
		*ppv = static_cast<IAMFilterMiscFlags *>(this);
	} else {
		*ppv = nullptr;
		return E_NOINTERFACE;
	}

	AddRef();
	return S_OK;
}

STDMETHODIMP_(ULONG) OpticXFilter::AddRef()
{
	return (ULONG)InterlockedIncrement(&m_refCount);
}

STDMETHODIMP_(ULONG) OpticXFilter::Release()
{
	const LONG refs = InterlockedDecrement(&m_refCount);
	if (refs == 0) {
		delete this;
		return 0;
	}
	return (ULONG)refs;
}

STDMETHODIMP OpticXFilter::GetClassID(CLSID *pClsID)
{
	if (!pClsID)
		return E_POINTER;

	*pClsID = CLSID_OpticXVCam;
	return S_OK;
}

STDMETHODIMP OpticXFilter::GetState(DWORD, FILTER_STATE *State)
{
	if (!State)
		return E_POINTER;

	*State = CurrentState();
	return S_OK;
}

STDMETHODIMP OpticXFilter::SetSyncSource(IReferenceClock *pClock)
{
	EnterCriticalSection(&m_lock);
	if (pClock)
		pClock->AddRef();
	if (m_clock)
		m_clock->Release();
	m_clock = pClock;
	LeaveCriticalSection(&m_lock);
	return S_OK;
}

STDMETHODIMP OpticXFilter::GetSyncSource(IReferenceClock **pClock)
{
	if (!pClock)
		return E_POINTER;

	EnterCriticalSection(&m_lock);
	*pClock = m_clock;
	if (*pClock)
		(*pClock)->AddRef();
	LeaveCriticalSection(&m_lock);
	return S_OK;
}

STDMETHODIMP OpticXFilter::Stop()
{
	EnterCriticalSection(&m_lock);
	const bool wasStopped = m_state == State_Stopped;
	m_state = State_Stopped;
	LeaveCriticalSection(&m_lock);

	if (!wasStopped && m_pin) {
		m_pin->StopStreaming();
		m_pin->FlushDownstream();
	}

	return S_OK;
}

STDMETHODIMP OpticXFilter::Pause()
{
	if (!m_pin)
		return E_UNEXPECTED;

	HRESULT hr = m_pin->CommitAllocator();
	if (FAILED(hr))
		return hr;

	// Video-capture clients commonly enter Pause and wait for a preroll sample
	// before they ever call Run. A source that starts only in Run deadlocks
	// Chromium and Discord at their loading indicator.
	EnterCriticalSection(&m_lock);
	m_state = State_Paused;
	LeaveCriticalSection(&m_lock);

	hr = m_pin->StartStreaming();
	if (FAILED(hr)) {
		EnterCriticalSection(&m_lock);
		m_state = State_Stopped;
		LeaveCriticalSection(&m_lock);
	}
	return hr;
}

STDMETHODIMP OpticXFilter::Run(REFERENCE_TIME)
{
	if (!m_pin)
		return E_UNEXPECTED;

	HRESULT hr = m_pin->CommitAllocator();
	if (FAILED(hr))
		return hr;

	EnterCriticalSection(&m_lock);
	m_state = State_Running;
	LeaveCriticalSection(&m_lock);

	hr = m_pin->StartStreaming();
	if (FAILED(hr)) {
		EnterCriticalSection(&m_lock);
		m_state = State_Paused;
		LeaveCriticalSection(&m_lock);
	}

	return hr;
}

STDMETHODIMP OpticXFilter::EnumPins(IEnumPins **ppEnum)
{
	if (!ppEnum)
		return E_POINTER;

	*ppEnum = new (std::nothrow) OpticXEnumPins(this, 0);
	if (!*ppEnum)
		return E_OUTOFMEMORY;

	(*ppEnum)->AddRef();
	return S_OK;
}

STDMETHODIMP OpticXFilter::FindPin(LPCWSTR Id, IPin **ppPin)
{
	if (!Id || !ppPin)
		return E_POINTER;

	if (m_pin && lstrcmpW(Id, OPTICX_PIN_ID) == 0) {
		*ppPin = static_cast<IPin *>(m_pin);
		(*ppPin)->AddRef();
		return S_OK;
	}

	*ppPin = nullptr;
	return VFW_E_NOT_FOUND;
}

STDMETHODIMP OpticXFilter::QueryFilterInfo(FILTER_INFO *pInfo)
{
	if (!pInfo)
		return E_POINTER;

	wcscpy_s(pInfo->achName, OPTICX_FILTER_NAME);

	EnterCriticalSection(&m_lock);
	pInfo->pGraph = m_graph;
	if (pInfo->pGraph)
		pInfo->pGraph->AddRef();
	LeaveCriticalSection(&m_lock);

	return S_OK;
}

STDMETHODIMP OpticXFilter::JoinFilterGraph(IFilterGraph *pGraph, LPCWSTR)
{
	// Deliberately not ref-counted: the graph owns the filter.
	EnterCriticalSection(&m_lock);
	m_graph = pGraph;
	LeaveCriticalSection(&m_lock);
	return S_OK;
}

STDMETHODIMP OpticXFilter::QueryVendorInfo(LPWSTR *)
{
	return E_NOTIMPL;
}

STDMETHODIMP_(ULONG) OpticXFilter::GetMiscFlags()
{
	return AM_FILTER_MISC_FLAGS_IS_SOURCE;
}

// ===========================================================================
// OpticXEnumPins
// ===========================================================================

OpticXEnumPins::OpticXEnumPins(OpticXFilter *filter, ULONG cursor) : m_filter(filter), m_cursor(cursor)
{
	m_filter->AddRef();
}

OpticXEnumPins::~OpticXEnumPins()
{
	m_filter->Release();
}

STDMETHODIMP OpticXEnumPins::QueryInterface(REFIID riid, void **ppv)
{
	if (!ppv)
		return E_POINTER;

	if (riid == IID_IUnknown || riid == IID_IEnumPins) {
		*ppv = static_cast<IEnumPins *>(this);
		AddRef();
		return S_OK;
	}

	*ppv = nullptr;
	return E_NOINTERFACE;
}

STDMETHODIMP_(ULONG) OpticXEnumPins::AddRef()
{
	return (ULONG)InterlockedIncrement(&m_refCount);
}

STDMETHODIMP_(ULONG) OpticXEnumPins::Release()
{
	const LONG refs = InterlockedDecrement(&m_refCount);
	if (refs == 0) {
		delete this;
		return 0;
	}
	return (ULONG)refs;
}

STDMETHODIMP OpticXEnumPins::Next(ULONG cPins, IPin **ppPins, ULONG *pcFetched)
{
	if (!ppPins)
		return E_POINTER;
	if (cPins != 1 && !pcFetched)
		return E_INVALIDARG;

	ULONG fetched = 0;
	if (cPins > 0 && m_cursor == 0) {
		IPin *pin = static_cast<IPin *>(m_filter->Pin());
		if (pin) {
			pin->AddRef();
			ppPins[0] = pin;
			fetched = 1;
		}
		++m_cursor;
	}

	if (pcFetched)
		*pcFetched = fetched;

	return fetched == cPins ? S_OK : S_FALSE;
}

STDMETHODIMP OpticXEnumPins::Skip(ULONG cPins)
{
	m_cursor += cPins;
	return m_cursor > 1 ? S_FALSE : S_OK;
}

STDMETHODIMP OpticXEnumPins::Reset()
{
	m_cursor = 0;
	return S_OK;
}

STDMETHODIMP OpticXEnumPins::Clone(IEnumPins **ppEnum)
{
	if (!ppEnum)
		return E_POINTER;

	*ppEnum = new (std::nothrow) OpticXEnumPins(m_filter, m_cursor);
	if (!*ppEnum)
		return E_OUTOFMEMORY;

	(*ppEnum)->AddRef();
	return S_OK;
}

// ===========================================================================
// OpticXEnumMediaTypes
// ===========================================================================

OpticXEnumMediaTypes::OpticXEnumMediaTypes(OpticXPin *pin, ULONG cursor) : m_pin(pin), m_cursor(cursor)
{
	m_pin->AddRef();
}

OpticXEnumMediaTypes::~OpticXEnumMediaTypes()
{
	m_pin->Release();
}

STDMETHODIMP OpticXEnumMediaTypes::QueryInterface(REFIID riid, void **ppv)
{
	if (!ppv)
		return E_POINTER;

	if (riid == IID_IUnknown || riid == IID_IEnumMediaTypes) {
		*ppv = static_cast<IEnumMediaTypes *>(this);
		AddRef();
		return S_OK;
	}

	*ppv = nullptr;
	return E_NOINTERFACE;
}

STDMETHODIMP_(ULONG) OpticXEnumMediaTypes::AddRef()
{
	return (ULONG)InterlockedIncrement(&m_refCount);
}

STDMETHODIMP_(ULONG) OpticXEnumMediaTypes::Release()
{
	const LONG refs = InterlockedDecrement(&m_refCount);
	if (refs == 0) {
		delete this;
		return 0;
	}
	return (ULONG)refs;
}

STDMETHODIMP OpticXEnumMediaTypes::Next(ULONG cMediaTypes, AM_MEDIA_TYPE **ppMediaTypes, ULONG *pcFetched)
{
	if (!ppMediaTypes)
		return E_POINTER;
	if (cMediaTypes != 1 && !pcFetched)
		return E_INVALIDARG;

	ULONG fetched = 0;
	while (fetched < cMediaTypes && m_cursor < (ULONG)kVCamMediaTypeCount) {
		AM_MEDIA_TYPE *mt = DuplicateMediaType(m_pin->MediaType((int)m_cursor));
		if (!mt) {
			// Release whatever we already handed out.
			for (ULONG i = 0; i < fetched; i++)
				DeleteMediaType(ppMediaTypes[i]);
			if (pcFetched)
				*pcFetched = 0;
			return E_OUTOFMEMORY;
		}

		ppMediaTypes[fetched++] = mt;
		++m_cursor;
	}

	if (pcFetched)
		*pcFetched = fetched;

	return fetched == cMediaTypes ? S_OK : S_FALSE;
}

STDMETHODIMP OpticXEnumMediaTypes::Skip(ULONG cMediaTypes)
{
	m_cursor += cMediaTypes;
	return m_cursor > (ULONG)kVCamMediaTypeCount ? S_FALSE : S_OK;
}

STDMETHODIMP OpticXEnumMediaTypes::Reset()
{
	m_cursor = 0;
	return S_OK;
}

STDMETHODIMP OpticXEnumMediaTypes::Clone(IEnumMediaTypes **ppEnum)
{
	if (!ppEnum)
		return E_POINTER;

	*ppEnum = new (std::nothrow) OpticXEnumMediaTypes(m_pin, m_cursor);
	if (!*ppEnum)
		return E_OUTOFMEMORY;

	(*ppEnum)->AddRef();
	return S_OK;
}
