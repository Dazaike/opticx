// In-process smoke test for opticx-vcam.dll.
//
// Loads the DLL, instantiates the filter through its class factory, connects
// the output pin to a minimal sink pin, and verifies the advertised media
// types, the black-frame fallback, and the negotiated/queue-driven pacing
// rules from the contract.
//
// Build with -DOPTICX_BUILD_TEST=ON, then run opticx-smoke-test.exe.

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <windows.h>
#include <dshow.h>

#include <atomic>
#include <cstdint>
#include <cstdio>
#include <thread>
#include <vector>

static const GUID kClsidOpticX = {0xa7e3c1d4, 0x5b92, 0x4e68, {0x9f, 0x0a, 0x3c, 0x7d, 0x81, 0xb6, 0xe2, 0x55}};

constexpr uint32_t kWidth = 1920;
constexpr uint32_t kHeight = 1080;
constexpr uint32_t kLumaSize = kWidth * kHeight;
constexpr uint32_t kFrameSize = kWidth * kHeight * 3 / 2;
constexpr int64_t kInterval30 = 333333;
constexpr int64_t kInterval60 = 166666;

constexpr uint8_t kPatternLuma = 0x77;
constexpr uint8_t kPatternChroma = 0x33;

static int g_failures = 0;

static void Check(bool ok, const char *what)
{
	printf("%s  %s\n", ok ? "[ ok ]" : "[FAIL]", what);
	if (!ok)
		++g_failures;
}

// ---------------------------------------------------------------------------
// Minimal sink: one input pin that accepts anything and tallies samples.
// ---------------------------------------------------------------------------

struct SampleStats {
	std::atomic<uint32_t> count{0};
	std::atomic<uint32_t> badLength{0};
	std::atomic<uint32_t> blackFrames{0};
	std::atomic<uint32_t> patternFrames{0};
	std::atomic<uint32_t> otherFrames{0};
	std::atomic<int64_t> lastStart{-1};
	std::atomic<int64_t> lastDelta{0};
	std::atomic<uint32_t> delta30{0};
	std::atomic<uint32_t> delta60{0};
	std::atomic<uint32_t> deltaOther{0};
	std::atomic<uint32_t> nonMonotonic{0};
	std::atomic<uint32_t> firstDiscontinuity{0};
	std::atomic<uint32_t> nonSyncPoint{0};
};

class SinkPin : public IPin, public IMemInputPin {
public:
	explicit SinkPin(SampleStats *stats) : m_stats(stats) {}

	STDMETHODIMP QueryInterface(REFIID riid, void **ppv) override
	{
		if (riid == IID_IUnknown || riid == IID_IPin)
			*ppv = static_cast<IPin *>(this);
		else if (riid == IID_IMemInputPin)
			*ppv = static_cast<IMemInputPin *>(this);
		else {
			*ppv = nullptr;
			return E_NOINTERFACE;
		}
		AddRef();
		return S_OK;
	}
	STDMETHODIMP_(ULONG) AddRef() override { return (ULONG)InterlockedIncrement(&m_refs); }
	STDMETHODIMP_(ULONG) Release() override
	{
		LONG r = InterlockedDecrement(&m_refs);
		if (!r) {
			delete this;
			return 0;
		}
		return (ULONG)r;
	}

	// IPin
	STDMETHODIMP Connect(IPin *, const AM_MEDIA_TYPE *) override { return E_UNEXPECTED; }
	STDMETHODIMP ReceiveConnection(IPin *pin, const AM_MEDIA_TYPE *pmt) override
	{
		if (!pmt || !pmt->pbFormat || pmt->cbFormat < sizeof(VIDEOINFOHEADER))
			return VFW_E_TYPE_NOT_ACCEPTED;

		const VIDEOINFOHEADER *vih = (const VIDEOINFOHEADER *)pmt->pbFormat;
		m_offeredOk = pmt->majortype == MEDIATYPE_Video && pmt->subtype == MEDIASUBTYPE_NV12 &&
			      pmt->formattype == FORMAT_VideoInfo && pmt->bFixedSizeSamples == TRUE &&
			      pmt->bTemporalCompression == FALSE && pmt->lSampleSize == kFrameSize &&
			      vih->bmiHeader.biSize == sizeof(BITMAPINFOHEADER) &&
			      vih->bmiHeader.biWidth == (LONG)kWidth && vih->bmiHeader.biHeight == (LONG)kHeight &&
			      vih->bmiHeader.biPlanes == 1 && vih->bmiHeader.biBitCount == 12 &&
			      vih->bmiHeader.biCompression == MAKEFOURCC('N', 'V', '1', '2') &&
			      vih->bmiHeader.biSizeImage == kFrameSize;
		m_offeredInterval = vih->AvgTimePerFrame;

		m_upstream = pin;
		return S_OK;
	}
	STDMETHODIMP Disconnect() override
	{
		m_upstream = nullptr;
		return S_OK;
	}
	STDMETHODIMP ConnectedTo(IPin **pPin) override
	{
		*pPin = m_upstream;
		if (m_upstream)
			m_upstream->AddRef();
		return m_upstream ? S_OK : VFW_E_NOT_CONNECTED;
	}
	STDMETHODIMP ConnectionMediaType(AM_MEDIA_TYPE *) override { return E_NOTIMPL; }
	STDMETHODIMP QueryPinInfo(PIN_INFO *pInfo) override
	{
		pInfo->pFilter = nullptr;
		pInfo->dir = PINDIR_INPUT;
		wcscpy_s(pInfo->achName, L"Sink");
		return S_OK;
	}
	STDMETHODIMP QueryDirection(PIN_DIRECTION *dir) override
	{
		*dir = PINDIR_INPUT;
		return S_OK;
	}
	STDMETHODIMP QueryId(LPWSTR *) override { return E_NOTIMPL; }
	STDMETHODIMP QueryAccept(const AM_MEDIA_TYPE *) override { return S_OK; }
	STDMETHODIMP EnumMediaTypes(IEnumMediaTypes **) override { return E_NOTIMPL; }
	STDMETHODIMP QueryInternalConnections(IPin **, ULONG *) override { return E_NOTIMPL; }
	STDMETHODIMP EndOfStream() override { return S_OK; }
	STDMETHODIMP BeginFlush() override { return S_OK; }
	STDMETHODIMP EndFlush() override { return S_OK; }
	STDMETHODIMP NewSegment(REFERENCE_TIME, REFERENCE_TIME, double) override { return S_OK; }

	// IMemInputPin
	STDMETHODIMP GetAllocator(IMemAllocator **ppAllocator) override
	{
		*ppAllocator = nullptr;
		return VFW_E_NO_ALLOCATOR;
	}
	STDMETHODIMP NotifyAllocator(IMemAllocator *, BOOL) override { return S_OK; }
	STDMETHODIMP GetAllocatorRequirements(ALLOCATOR_PROPERTIES *) override { return E_NOTIMPL; }
	STDMETHODIMP ReceiveCanBlock() override { return S_FALSE; }
	STDMETHODIMP ReceiveMultiple(IMediaSample **samples, long n, long *processed) override
	{
		for (long i = 0; i < n; i++) {
			HRESULT hr = Receive(samples[i]);
			if (FAILED(hr)) {
				*processed = i;
				return hr;
			}
		}
		*processed = n;
		return S_OK;
	}
	STDMETHODIMP Receive(IMediaSample *sample) override
	{
		const long len = sample->GetActualDataLength();
		BYTE *ptr = nullptr;
		sample->GetPointer(&ptr);

		if (len != (long)kFrameSize || !ptr) {
			++m_stats->badLength;
			++m_stats->count;
			return S_OK;
		}

		if (sample->IsSyncPoint() != S_OK)
			++m_stats->nonSyncPoint;
		if (m_stats->count.load() == 0 && sample->IsDiscontinuity() == S_OK)
			++m_stats->firstDiscontinuity;

		REFERENCE_TIME start = 0, stop = 0;
		if (SUCCEEDED(sample->GetTime(&start, &stop))) {
			const int64_t prev = m_stats->lastStart.load();
			if (prev >= 0) {
				if (start <= prev)
					++m_stats->nonMonotonic;
				const int64_t delta = start - prev;
				m_stats->lastDelta.store(delta);
				if (delta == kInterval30)
					++m_stats->delta30;
				else if (delta == kInterval60)
					++m_stats->delta60;
				else
					++m_stats->deltaOther;
			}
			m_stats->lastStart.store(start);
		}

		// Classify by sampling well-spread pixels of both planes.
		const bool black = ptr[0] == 0x10 && ptr[kLumaSize / 2] == 0x10 && ptr[kLumaSize - 1] == 0x10 &&
				   ptr[kLumaSize] == 0x80 && ptr[kFrameSize - 1] == 0x80;
		const bool pattern = ptr[0] == kPatternLuma && ptr[kLumaSize / 2] == kPatternLuma &&
				     ptr[kLumaSize - 1] == kPatternLuma && ptr[kLumaSize] == kPatternChroma &&
				     ptr[kFrameSize - 1] == kPatternChroma;

		if (black)
			++m_stats->blackFrames;
		else if (pattern)
			++m_stats->patternFrames;
		else
			++m_stats->otherFrames;

		++m_stats->count;
		return S_OK;
	}

	bool OfferedTypeOk() const { return m_offeredOk; }
	int64_t OfferedInterval() const { return m_offeredInterval; }

private:
	~SinkPin() = default;

	volatile LONG m_refs = 1;
	SampleStats *m_stats;
	IPin *m_upstream = nullptr;
	bool m_offeredOk = false;
	int64_t m_offeredInterval = 0;
};

// ---------------------------------------------------------------------------
// Producer half of the OpticXCamVideo queue.
// ---------------------------------------------------------------------------

class Producer {
public:
	static constexpr uint32_t kHeaderSize = 0x50;

	~Producer() { Destroy(); }

	bool Create(int64_t intervalField)
	{
		const uint32_t align = 32;
		auto alignUp = [align](uint32_t v) { return (v + align - 1) & ~(align - 1); };

		uint32_t size = alignUp(kHeaderSize);
		for (int i = 0; i < 3; i++) {
			m_offsets[i] = size;
			size = alignUp(size + kFrameSize + 32);
		}
		m_total = size;

		m_mapping = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0, m_total,
					       L"OpticXCamVideo");
		if (!m_mapping)
			return false;

		m_view = (uint8_t *)MapViewOfFile(m_mapping, FILE_MAP_ALL_ACCESS, 0, 0, 0);
		if (!m_view)
			return false;

		memset(m_view, 0, kHeaderSize);
		Put32(0x0C, m_offsets[0]);
		Put32(0x10, m_offsets[1]);
		Put32(0x14, m_offsets[2]);
		Put32(0x18, 0);       // type = video
		Put32(0x1C, kWidth);  // cx
		Put32(0x20, kHeight); // cy
		*(uint64_t *)(m_view + 0x28) = (uint64_t)intervalField;
		Put32(0x08, 1); // STARTING
		return true;
	}

	void WriteFrame()
	{
		const uint32_t inc = ++m_writeIdx;
		Put32(0x00, inc);

		uint8_t *slot = m_view + m_offsets[inc % 3];
		*(uint64_t *)slot = (uint64_t)inc * 333333ULL;
		memset(slot + 32, kPatternLuma, kLumaSize);
		memset(slot + 32 + kLumaSize, kPatternChroma, kFrameSize - kLumaSize);

		MemoryBarrier();
		Put32(0x04, inc); // read_idx
		Put32(0x08, 2);   // READY
	}

	// Writes faster than either advertised rate so the reader never sees a
	// stall; pacing must come from the header's interval field, not this.
	void StartWriting()
	{
		m_writing = true;
		m_writer = std::thread([this] {
			while (m_writing.load()) {
				WriteFrame();
				Sleep(8);
			}
		});
	}

	void StopWriting()
	{
		if (m_writer.joinable()) {
			m_writing = false;
			m_writer.join();
		}
	}

	void SetStopping() { Put32(0x08, 3); }

	void Destroy()
	{
		StopWriting();
		if (m_view)
			UnmapViewOfFile(m_view);
		if (m_mapping)
			CloseHandle(m_mapping);
		m_view = nullptr;
		m_mapping = nullptr;
	}

	uint32_t TotalSize() const { return m_total; }
	uint32_t Offset(int i) const { return m_offsets[i]; }

private:
	void Put32(uint32_t off, uint32_t value) { *(volatile uint32_t *)(m_view + off) = value; }

	HANDLE m_mapping = nullptr;
	uint8_t *m_view = nullptr;
	uint32_t m_offsets[3] = {};
	uint32_t m_total = 0;
	uint32_t m_writeIdx = 0;
	std::atomic<bool> m_writing{false};
	std::thread m_writer;
};

// ---------------------------------------------------------------------------
// Pacing scenarios
// ---------------------------------------------------------------------------

// Runs a fresh filter for `windowMs` with the given negotiated rate and
// (optional) producer, and reports how many samples were pushed.
struct ScenarioResult {
	uint32_t samples = 0;
	uint32_t black = 0;
	uint32_t pattern = 0;
	uint32_t other = 0;
	uint32_t badLength = 0;
	int64_t lastDelta = 0;
	uint32_t delta30 = 0;
	uint32_t delta60 = 0;
	uint32_t deltaOther = 0;
	int64_t offeredInterval = 0;
	bool connected = false;
};

static ScenarioResult RunScenario(IClassFactory *factory, int64_t negotiated, Producer *producer, DWORD windowMs)
{
	ScenarioResult result;

	IBaseFilter *filter = nullptr;
	if (FAILED(factory->CreateInstance(nullptr, IID_IBaseFilter, (void **)&filter)) || !filter)
		return result;

	IEnumPins *enumPins = nullptr;
	IPin *outPin = nullptr;
	ULONG fetched = 0;
	filter->EnumPins(&enumPins);
	enumPins->Next(1, &outPin, &fetched);
	enumPins->Release();

	// Negotiate the requested rate through IAMStreamConfig, exactly as a
	// capture app would.
	IAMStreamConfig *config = nullptr;
	outPin->QueryInterface(IID_IAMStreamConfig, (void **)&config);
	std::vector<BYTE> scc(sizeof(VIDEO_STREAM_CONFIG_CAPS));
	for (int i = 0; i < 2; i++) {
		AM_MEDIA_TYPE *mt = nullptr;
		if (config->GetStreamCaps(i, &mt, scc.data()) != S_OK || !mt)
			continue;
		const VIDEOINFOHEADER *vih = (const VIDEOINFOHEADER *)mt->pbFormat;
		if (vih->AvgTimePerFrame == negotiated)
			config->SetFormat(mt);
		CoTaskMemFree(mt->pbFormat);
		CoTaskMemFree(mt);
	}
	config->Release();

	SampleStats stats;
	SinkPin *sink = new SinkPin(&stats);
	result.connected = SUCCEEDED(outPin->Connect(sink, nullptr));

	if (result.connected) {
		if (producer)
			producer->StartWriting();

		filter->Pause();
		filter->Run(0);
		// Let the reader latch onto the producer before measuring.
		Sleep(120);
		const uint32_t before = stats.count.load();
		const uint32_t blackBefore = stats.blackFrames.load();
		const uint32_t patternBefore = stats.patternFrames.load();
		const uint32_t otherBefore = stats.otherFrames.load();
		const uint32_t d30Before = stats.delta30.load();
		const uint32_t d60Before = stats.delta60.load();
		const uint32_t dOtherBefore = stats.deltaOther.load();
		Sleep(windowMs);

		result.samples = stats.count.load() - before;
		result.black = stats.blackFrames.load() - blackBefore;
		result.pattern = stats.patternFrames.load() - patternBefore;
		result.other = stats.otherFrames.load() - otherBefore;
		result.badLength = stats.badLength.load();
		result.lastDelta = stats.lastDelta.load();
		result.delta30 = stats.delta30.load() - d30Before;
		result.delta60 = stats.delta60.load() - d60Before;
		result.deltaOther = stats.deltaOther.load() - dOtherBefore;
		result.offeredInterval = sink->OfferedInterval();

		filter->Stop();
		outPin->Disconnect();

		if (producer)
			producer->StopWriting();
	}

	outPin->Release();
	filter->Release();
	sink->Release();
	return result;
}

static bool NearRate(uint32_t samples, DWORD windowMs, int64_t interval)
{
	const double expected = (double)windowMs * 10000.0 / (double)interval;
	const double ratio = (double)samples / expected;
	return ratio > 0.80 && ratio < 1.20;
}

// ---------------------------------------------------------------------------

int main()
{
	CoInitializeEx(nullptr, COINIT_MULTITHREADED);

	HMODULE dll = LoadLibraryW(L"opticx-vcam.dll");
	Check(dll != nullptr, "LoadLibrary(opticx-vcam.dll)");
	if (!dll)
		return 1;

	using GetClassObjectFn = HRESULT(STDAPICALLTYPE *)(REFCLSID, REFIID, void **);
	using CanUnloadFn = HRESULT(STDAPICALLTYPE *)();

	auto getClassObject = (GetClassObjectFn)GetProcAddress(dll, "DllGetClassObject");
	auto canUnload = (CanUnloadFn)GetProcAddress(dll, "DllCanUnloadNow");
	Check(getClassObject && canUnload, "DllGetClassObject/DllCanUnloadNow resolved");
	if (!getClassObject || !canUnload)
		return 1;

	Check(canUnload() == S_OK, "DllCanUnloadNow() == S_OK before any object exists");

	IClassFactory *factory = nullptr;
	HRESULT hr = getClassObject(kClsidOpticX, IID_IClassFactory, (void **)&factory);
	Check(SUCCEEDED(hr) && factory, "DllGetClassObject -> IClassFactory");
	if (!factory)
		return 1;

	GUID wrongClsid = kClsidOpticX;
	wrongClsid.Data1 ^= 1;
	void *dummy = nullptr;
	Check(getClassObject(wrongClsid, IID_IClassFactory, &dummy) == CLASS_E_CLASSNOTAVAILABLE,
	      "unknown CLSID -> CLASS_E_CLASSNOTAVAILABLE");

	IBaseFilter *filter = nullptr;
	hr = factory->CreateInstance(nullptr, IID_IBaseFilter, (void **)&filter);
	Check(SUCCEEDED(hr) && filter, "CreateInstance -> IBaseFilter");
	if (!filter)
		return 1;

	Check(canUnload() == S_FALSE, "DllCanUnloadNow() == S_FALSE while filter is alive");

	CLSID clsid = {};
	Check(SUCCEEDED(filter->GetClassID(&clsid)) && IsEqualCLSID(clsid, kClsidOpticX), "GetClassID matches CLSID");

	FILTER_INFO fi = {};
	Check(SUCCEEDED(filter->QueryFilterInfo(&fi)) && wcscmp(fi.achName, L"OpticX Cam") == 0,
	      "QueryFilterInfo name == \"OpticX Cam\"");
	if (fi.pGraph)
		fi.pGraph->Release();

	IAMFilterMiscFlags *misc = nullptr;
	Check(SUCCEEDED(filter->QueryInterface(IID_IAMFilterMiscFlags, (void **)&misc)) && misc &&
		      misc->GetMiscFlags() == AM_FILTER_MISC_FLAGS_IS_SOURCE,
	      "IAMFilterMiscFlags == AM_FILTER_MISC_FLAGS_IS_SOURCE");
	if (misc)
		misc->Release();

	// Pin enumeration
	IEnumPins *enumPins = nullptr;
	Check(SUCCEEDED(filter->EnumPins(&enumPins)) && enumPins, "EnumPins");
	IPin *outPin = nullptr;
	ULONG fetched = 0;
	Check(enumPins->Next(1, &outPin, &fetched) == S_OK && fetched == 1 && outPin, "EnumPins::Next -> 1 pin");
	IPin *extra = nullptr;
	Check(enumPins->Next(1, &extra, &fetched) == S_FALSE && fetched == 0, "EnumPins::Next -> S_FALSE at end");
	enumPins->Reset();
	IPin *again = nullptr;
	Check(enumPins->Next(1, &again, &fetched) == S_OK && again == outPin, "EnumPins::Reset rewinds");
	if (again)
		again->Release();
	enumPins->Release();

	PIN_DIRECTION dir = PINDIR_INPUT;
	Check(SUCCEEDED(outPin->QueryDirection(&dir)) && dir == PINDIR_OUTPUT, "pin direction == PINDIR_OUTPUT");

	LPWSTR pinId = nullptr;
	Check(SUCCEEDED(outPin->QueryId(&pinId)) && pinId, "QueryId");
	IPin *found = nullptr;
	Check(SUCCEEDED(filter->FindPin(pinId, &found)) && found == outPin, "FindPin(QueryId) round-trips");
	if (found)
		found->Release();
	CoTaskMemFree(pinId);

	// IKsPropertySet -> capture category
	IKsPropertySet *props = nullptr;
	Check(SUCCEEDED(outPin->QueryInterface(IID_IKsPropertySet, (void **)&props)) && props, "pin IKsPropertySet");
	GUID category = GUID_NULL;
	DWORD returned = 0;
	Check(SUCCEEDED(props->Get(AMPROPSETID_Pin, AMPROPERTY_PIN_CATEGORY, nullptr, 0, &category, sizeof(category),
				   &returned)) &&
		      IsEqualGUID(category, PIN_CATEGORY_CAPTURE) && returned == sizeof(GUID),
	      "AMPROPERTY_PIN_CATEGORY == PIN_CATEGORY_CAPTURE");
	DWORD support = 0;
	Check(SUCCEEDED(props->QuerySupported(AMPROPSETID_Pin, AMPROPERTY_PIN_CATEGORY, &support)) &&
		      (support & KSPROPERTY_SUPPORT_GET),
	      "QuerySupported reports GET");
	props->Release();

	// --- IAMStreamConfig: two capabilities, 30fps then 60fps -------------
	IAMStreamConfig *config = nullptr;
	Check(SUCCEEDED(outPin->QueryInterface(IID_IAMStreamConfig, (void **)&config)) && config,
	      "pin IAMStreamConfig");
	int caps = 0, capSize = 0;
	Check(SUCCEEDED(config->GetNumberOfCapabilities(&caps, &capSize)) && caps == 2 &&
		      capSize == sizeof(VIDEO_STREAM_CONFIG_CAPS),
	      "GetNumberOfCapabilities -> 2 / VIDEO_STREAM_CONFIG_CAPS");

	std::vector<BYTE> sccBuf(sizeof(VIDEO_STREAM_CONFIG_CAPS));
	const int64_t expectIntervals[2] = {kInterval30, kInterval60};
	AM_MEDIA_TYPE *mt60 = nullptr;

	for (int i = 0; i < 2; i++) {
		AM_MEDIA_TYPE *capMt = nullptr;
		char label[96];
		const bool got = config->GetStreamCaps(i, &capMt, sccBuf.data()) == S_OK && capMt != nullptr;
		sprintf_s(label, "GetStreamCaps(%d) succeeds", i);
		Check(got, label);
		if (!got)
			continue;

		const VIDEOINFOHEADER *vih = (const VIDEOINFOHEADER *)capMt->pbFormat;
		const uint64_t expectBitRate = (uint64_t)kFrameSize * 8ULL * 10000000ULL / (uint64_t)expectIntervals[i];

		sprintf_s(label, "caps[%d] media type header fields", i);
		Check(capMt->majortype == MEDIATYPE_Video && capMt->subtype == MEDIASUBTYPE_NV12 &&
			      capMt->formattype == FORMAT_VideoInfo && capMt->lSampleSize == kFrameSize &&
			      capMt->bFixedSizeSamples == TRUE && capMt->bTemporalCompression == FALSE,
		      label);

		sprintf_s(label, "caps[%d] VIDEOINFOHEADER, AvgTimePerFrame == %lld", i, (long long)expectIntervals[i]);
		Check(vih->bmiHeader.biWidth == (LONG)kWidth && vih->bmiHeader.biHeight == (LONG)kHeight &&
			      vih->bmiHeader.biPlanes == 1 && vih->bmiHeader.biBitCount == 12 &&
			      vih->bmiHeader.biCompression == MAKEFOURCC('N', 'V', '1', '2') &&
			      vih->bmiHeader.biSizeImage == kFrameSize &&
			      vih->AvgTimePerFrame == expectIntervals[i] && vih->dwBitRate == (DWORD)expectBitRate,
		      label);

		const VIDEO_STREAM_CONFIG_CAPS *scc = (const VIDEO_STREAM_CONFIG_CAPS *)sccBuf.data();
		sprintf_s(label, "caps[%d] frame interval range 166666..333333", i);
		Check(scc->MinFrameInterval == kInterval60 && scc->MaxFrameInterval == kInterval30, label);

		if (expectIntervals[i] == kInterval60)
			mt60 = capMt;
		else {
			CoTaskMemFree(capMt->pbFormat);
			CoTaskMemFree(capMt);
		}
	}

	AM_MEDIA_TYPE *dummyMt = nullptr;
	Check(config->GetStreamCaps(2, &dummyMt, sccBuf.data()) == S_FALSE, "GetStreamCaps(2) -> S_FALSE");

	// Default format before any SetFormat is 30fps.
	AM_MEDIA_TYPE *defMt = nullptr;
	Check(SUCCEEDED(config->GetFormat(&defMt)) && defMt &&
		      ((const VIDEOINFOHEADER *)defMt->pbFormat)->AvgTimePerFrame == kInterval30,
	      "GetFormat default is 30fps");
	if (defMt) {
		CoTaskMemFree(defMt->pbFormat);
		CoTaskMemFree(defMt);
	}

	// SetFormat(60fps) switches the reported format.
	Check(mt60 != nullptr && SUCCEEDED(config->SetFormat(mt60)), "SetFormat(60fps type) succeeds");
	AM_MEDIA_TYPE *nowMt = nullptr;
	Check(SUCCEEDED(config->GetFormat(&nowMt)) && nowMt &&
		      ((const VIDEOINFOHEADER *)nowMt->pbFormat)->AvgTimePerFrame == kInterval60,
	      "GetFormat reports 60fps after SetFormat");
	if (nowMt) {
		CoTaskMemFree(nowMt->pbFormat);
		CoTaskMemFree(nowMt);
	}

	if (mt60) {
		// An unsupported rate must be refused.
		VIDEOINFOHEADER *vih60 = (VIDEOINFOHEADER *)mt60->pbFormat;
		const REFERENCE_TIME saved = vih60->AvgTimePerFrame;
		vih60->AvgTimePerFrame = 200000; // 50fps: not advertised
		Check(config->SetFormat(mt60) == VFW_E_INVALIDMEDIATYPE, "SetFormat(50fps) rejected");
		Check(outPin->QueryAccept(mt60) == S_FALSE, "QueryAccept(50fps) -> S_FALSE");
		vih60->AvgTimePerFrame = saved;
		Check(outPin->QueryAccept(mt60) == S_OK, "QueryAccept(60fps) -> S_OK");

		AM_MEDIA_TYPE bad = *mt60;
		bad.subtype = MEDIASUBTYPE_RGB24;
		bad.pbFormat = nullptr;
		bad.cbFormat = 0;
		Check(config->SetFormat(&bad) == VFW_E_INVALIDMEDIATYPE, "SetFormat(RGB24) rejected");

		CoTaskMemFree(mt60->pbFormat);
		CoTaskMemFree(mt60);
	}
	config->Release();

	// --- IEnumMediaTypes yields both types ------------------------------
	IEnumMediaTypes *enumMt = nullptr;
	Check(SUCCEEDED(outPin->EnumMediaTypes(&enumMt)) && enumMt, "EnumMediaTypes");
	AM_MEDIA_TYPE *both[2] = {};
	Check(enumMt->Next(2, both, &fetched) == S_OK && fetched == 2 && both[0] && both[1],
	      "EnumMediaTypes::Next(2) -> 2 types");
	if (both[0] && both[1]) {
		Check(((const VIDEOINFOHEADER *)both[0]->pbFormat)->AvgTimePerFrame == kInterval30 &&
			      ((const VIDEOINFOHEADER *)both[1]->pbFormat)->AvgTimePerFrame == kInterval60,
		      "EnumMediaTypes order is 30fps then 60fps");
	}
	for (auto *m : both) {
		if (m) {
			CoTaskMemFree(m->pbFormat);
			CoTaskMemFree(m);
		}
	}
	AM_MEDIA_TYPE *past = nullptr;
	Check(enumMt->Next(1, &past, &fetched) == S_FALSE && fetched == 0, "EnumMediaTypes::Next -> S_FALSE at end");
	enumMt->Reset();
	Check(enumMt->Next(1, &past, &fetched) == S_OK && fetched == 1, "EnumMediaTypes::Reset rewinds");
	if (past) {
		CoTaskMemFree(past->pbFormat);
		CoTaskMemFree(past);
	}
	enumMt->Release();

	// --- connect + stream on this instance (30fps, no producer) ----------
	SampleStats stats;
	SinkPin *sink = new SinkPin(&stats);

	Check(outPin->ConnectedTo(&extra) == VFW_E_NOT_CONNECTED, "ConnectedTo -> VFW_E_NOT_CONNECTED when idle");
	Check(SUCCEEDED(outPin->Connect(sink, nullptr)), "Connect(sink, null pmt)");
	Check(sink->OfferedTypeOk(), "sink received the exact contract media type");
	Check(sink->OfferedInterval() == kInterval60, "Connect offered the negotiated 60fps interval");
	Check(outPin->Connect(sink, nullptr) == VFW_E_ALREADY_CONNECTED, "second Connect -> ALREADY_CONNECTED");

	IPin *connectedTo = nullptr;
	Check(outPin->ConnectedTo(&connectedTo) == S_OK && connectedTo == static_cast<IPin *>(sink),
	      "ConnectedTo -> sink");
	if (connectedTo)
		connectedTo->Release();

	Check(SUCCEEDED(filter->Pause()), "Pause()");
	FILTER_STATE state = State_Stopped;
	Check(SUCCEEDED(filter->GetState(0, &state)) && state == State_Paused, "GetState -> Paused");
	Check(SUCCEEDED(filter->Run(0)), "Run()");
	Check(SUCCEEDED(filter->GetState(0, &state)) && state == State_Running, "GetState -> Running");
	Sleep(500);

	const uint32_t phaseA = stats.count.load();
	printf("       no producer @60fps: %u samples in 500ms (%u black)\n", phaseA, stats.blackFrames.load());
	Check(NearRate(phaseA, 500, kInterval60), "no-producer stream paced at the negotiated 60fps");
	Check(stats.blackFrames.load() == phaseA, "no-producer frames are all solid black");
	Check(stats.badLength.load() == 0, "every sample is exactly 3110400 bytes");
	Check(stats.firstDiscontinuity.load() == 1, "first sample flagged discontinuous");
	Check(stats.nonSyncPoint.load() == 0, "every sample is a sync point");
	Check(stats.nonMonotonic.load() == 0, "sample start times are strictly increasing");
	Check(stats.lastDelta.load() == kInterval60, "sample timestamp delta == negotiated interval");

	// Producer appears mid-stream -> pixels flow through.
	Producer live;
	Check(live.Create(kInterval60), "producer created OpticXCamVideo section");
	Check(live.TotalSize() == 9331392 && live.Offset(0) == 96 && live.Offset(1) == 3110528 &&
		      live.Offset(2) == 6220960,
	      "queue geometry matches contract (96 / 3110528 / 6220960, total 9331392)");
	live.StartWriting();
	Sleep(400);
	const uint32_t patternSeen = stats.patternFrames.load();
	printf("       live producer: %u frames carried producer pixels\n", patternSeen);
	Check(patternSeen >= 5, "live producer pixels reach the sink");

	// STOPPING -> black again. Let the transition settle first: a frame the
	// filter was already reading when state flipped is legitimately live.
	live.StopWriting();
	live.SetStopping();
	Sleep(80);
	const uint32_t blackBefore = stats.blackFrames.load();
	const uint32_t patternBefore = stats.patternFrames.load();
	Sleep(400);
	printf("       after STOPPING: %u new black frames, %u new pattern frames\n",
	       stats.blackFrames.load() - blackBefore, stats.patternFrames.load() - patternBefore);
	Check(stats.blackFrames.load() - blackBefore >= 8, "STOPPING falls back to black frames");
	Check(stats.patternFrames.load() == patternBefore, "no stale producer pixels after STOPPING");
	live.Destroy();

	// Teardown
	Check(SUCCEEDED(filter->Stop()), "Stop()");
	Check(SUCCEEDED(filter->GetState(0, &state)) && state == State_Stopped, "GetState -> Stopped");
	const uint32_t afterStop = stats.count.load();
	Sleep(200);
	Check(stats.count.load() == afterStop, "no samples arrive after Stop()");

	Check(outPin->Disconnect() == S_OK, "Disconnect()");
	Check(outPin->Disconnect() == S_FALSE, "second Disconnect -> S_FALSE");

	outPin->Release();
	Check(filter->Release() == 0, "filter refcount drops to zero");
	sink->Release();

	// --- pacing matrix ---------------------------------------------------
	printf("\n-- pacing matrix (400ms windows) --\n");

	const ScenarioResult s30 = RunScenario(factory, kInterval30, nullptr, 400);
	printf("       negotiated 30fps, no producer: %u samples\n", s30.samples);
	Check(s30.offeredInterval == kInterval30, "30fps negotiation offered 333333 downstream");
	Check(NearRate(s30.samples, 400, kInterval30), "negotiated 30fps paces at 30fps");
	Check(s30.black == s30.samples && s30.badLength == 0, "30fps no-producer frames all black");

	Producer p60;
	Check(p60.Create(kInterval60), "producer advertising interval 166666 created");
	const ScenarioResult s60q60 = RunScenario(factory, kInterval60, &p60, 400);
	printf("       negotiated 60fps, queue 166666: %u samples (%u pattern, %u black) deltas 30=%u 60=%u other=%u\n",
	       s60q60.samples, s60q60.pattern, s60q60.black, s60q60.delta30, s60q60.delta60, s60q60.deltaOther);
	Check(NearRate(s60q60.samples, 400, kInterval60), "60fps negotiated + 60fps queue paces at 60fps");
	Check(s60q60.pattern == s60q60.samples && s60q60.black == 0,
	      "every frame from a live 60fps queue carries producer pixels");
	Check(s60q60.delta60 == s60q60.samples, "60fps queue timestamps all advance by 166666");

	// Negotiated 30fps must never be exceeded even though the queue is 60fps.
	const ScenarioResult s30q60 = RunScenario(factory, kInterval30, &p60, 400);
	printf("       negotiated 30fps, queue 166666: %u samples (%u pattern, %u black) deltas 30=%u 60=%u other=%u\n",
	       s30q60.samples, s30q60.pattern, s30q60.black, s30q60.delta30, s30q60.delta60, s30q60.deltaOther);
	Check(NearRate(s30q60.samples, 400, kInterval30), "faster queue never exceeds the negotiated 30fps");
	Check(s30q60.delta30 == s30q60.samples, "clamped timestamps all advance by 333333");
	Check(s30q60.pattern == s30q60.samples && s30q60.black == 0, "producer pixels still flow at the clamped rate");
	p60.Destroy();

	// A 30fps queue slows a 60fps negotiation down to the queue's rate.
	Producer p30;
	Check(p30.Create(kInterval30), "producer advertising interval 333333 created");
	const ScenarioResult s60q30 = RunScenario(factory, kInterval60, &p30, 400);
	printf("       negotiated 60fps, queue 333333: %u samples (%u pattern, %u black) deltas 30=%u 60=%u other=%u\n",
	       s60q30.samples, s60q30.pattern, s60q30.black, s60q30.delta30, s60q30.delta60, s60q30.deltaOther);
	Check(NearRate(s60q30.samples, 400, kInterval30), "60fps negotiated follows the slower 333333 queue");
	Check(s60q30.delta30 == s60q30.samples, "queue-paced timestamps all advance by 333333");
	Check(s60q30.pattern == s60q30.samples && s60q30.black == 0,
	      "every frame from a live 30fps queue carries producer pixels");
	p30.Destroy();

	// A bogus queue interval is clamped to the negotiated rate.
	Producer pBogus;
	Check(pBogus.Create(123456), "producer advertising bogus interval 123456 created");
	const ScenarioResult sBogus = RunScenario(factory, kInterval60, &pBogus, 400);
	printf("       negotiated 60fps, queue 123456: %u samples (%u pattern, %u black) deltas 30=%u 60=%u other=%u\n",
	       sBogus.samples, sBogus.pattern, sBogus.black, sBogus.delta30, sBogus.delta60, sBogus.deltaOther);
	Check(NearRate(sBogus.samples, 400, kInterval60), "bogus queue interval clamps to the negotiated 60fps");
	Check(sBogus.delta60 == sBogus.samples, "bogus-interval timestamps fall back to 166666");
	Check(sBogus.pattern == sBogus.samples && sBogus.black == 0,
	      "bogus-interval queue frames still carry pixels");
	pBogus.Destroy();

	// --- producer restart: the writer recreates the section to change fps -
	printf("\n-- producer restart (fps switch republishes the section) --\n");
	{
		IBaseFilter *rf = nullptr;
		factory->CreateInstance(nullptr, IID_IBaseFilter, (void **)&rf);

		IEnumPins *rpins = nullptr;
		IPin *rpin = nullptr;
		ULONG rgot = 0;
		rf->EnumPins(&rpins);
		rpins->Next(1, &rpin, &rgot);
		rpins->Release();

		// Negotiate 60fps so the queue's interval is what limits pacing.
		IAMStreamConfig *rcfg = nullptr;
		rpin->QueryInterface(IID_IAMStreamConfig, (void **)&rcfg);
		std::vector<BYTE> rscc(sizeof(VIDEO_STREAM_CONFIG_CAPS));
		AM_MEDIA_TYPE *rmt = nullptr;
		if (rcfg->GetStreamCaps(1, &rmt, rscc.data()) == S_OK && rmt) {
			rcfg->SetFormat(rmt);
			CoTaskMemFree(rmt->pbFormat);
			CoTaskMemFree(rmt);
		}
		rcfg->Release();

		SampleStats rstats;
		SinkPin *rsink = new SinkPin(&rstats);
		Check(SUCCEEDED(rpin->Connect(rsink, nullptr)), "restart: connect at 60fps");

		// Phase 1: producer publishing a 30fps queue.
		Producer *a = new Producer();
		Check(a->Create(kInterval30), "restart: producer A advertises 333333");
		a->StartWriting();
		rf->Pause();
		rf->Run(0);
		Sleep(200);

		uint32_t d30 = rstats.delta30.load(), d60 = rstats.delta60.load();
		uint32_t pat = rstats.patternFrames.load();
		Sleep(400);
		const uint32_t a30 = rstats.delta30.load() - d30;
		const uint32_t a60 = rstats.delta60.load() - d60;
		const uint32_t aPat = rstats.patternFrames.load() - pat;
		printf("       producer A (333333): %u pattern frames, deltas 30=%u 60=%u\n", aPat, a30, a60);
		Check(a30 > 0 && a60 == 0, "restart: phase A paced by the 333333 queue");
		Check(aPat >= a30, "restart: phase A frames carry producer pixels");

		// The writer's fps switch: STOPPING, tear down, republish.
		a->StopWriting();
		a->SetStopping();
		a->Destroy();
		delete a;

		Producer *b = new Producer();
		Check(b->Create(kInterval60), "restart: producer B advertises 166666");
		b->StartWriting();
		// Must be picked up quickly; the reopen throttle is only 3 polls.
		Sleep(250);

		d30 = rstats.delta30.load();
		d60 = rstats.delta60.load();
		pat = rstats.patternFrames.load();
		uint32_t blk = rstats.blackFrames.load();
		Sleep(400);
		const uint32_t b30 = rstats.delta30.load() - d30;
		const uint32_t b60 = rstats.delta60.load() - d60;
		const uint32_t bPat = rstats.patternFrames.load() - pat;
		const uint32_t bBlk = rstats.blackFrames.load() - blk;
		printf("       producer B (166666): %u pattern frames, %u black, deltas 30=%u 60=%u\n", bPat, bBlk,
		       b30, b60);
		Check(b60 > 0 && b30 == 0, "restart: republished section switches pacing to 166666");
		Check(bPat > 0 && bBlk == 0, "restart: producer B pixels reach the sink, no black");
		Check(NearRate(bPat, 400, kInterval60), "restart: phase B streams at a full 60fps");

		b->StopWriting();
		b->SetStopping();
		b->Destroy();
		delete b;

		rf->Stop();
		rpin->Disconnect();
		rpin->Release();
		Check(rf->Release() == 0, "restart: filter refcount drops to zero");
		rsink->Release();
	}

	Check(factory->Release() == 0, "factory refcount drops to zero");
	Check(canUnload() == S_OK, "DllCanUnloadNow() == S_OK after teardown");

	CoUninitialize();

	printf("\n%s (%d failure%s)\n", g_failures ? "FAILED" : "PASSED", g_failures, g_failures == 1 ? "" : "s");
	return g_failures ? 1 : 0;
}
