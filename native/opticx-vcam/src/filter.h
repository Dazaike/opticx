// OpticX Cam DirectShow push-source filter.

#pragma once

#include "opticx-common.h"
#include "shm-reader.h"

class OpticXFilter;

// ---------------------------------------------------------------------------
// Output pin
// ---------------------------------------------------------------------------

class OpticXPin : public IPin, public IAMStreamConfig, public IKsPropertySet {
public:
	explicit OpticXPin(OpticXFilter *filter);

	// IUnknown
	STDMETHODIMP QueryInterface(REFIID riid, void **ppv) override;
	STDMETHODIMP_(ULONG) AddRef() override;
	STDMETHODIMP_(ULONG) Release() override;

	// IPin
	STDMETHODIMP Connect(IPin *pReceivePin, const AM_MEDIA_TYPE *pmt) override;
	STDMETHODIMP ReceiveConnection(IPin *pConnector, const AM_MEDIA_TYPE *pmt) override;
	STDMETHODIMP Disconnect() override;
	STDMETHODIMP ConnectedTo(IPin **pPin) override;
	STDMETHODIMP ConnectionMediaType(AM_MEDIA_TYPE *pmt) override;
	STDMETHODIMP QueryPinInfo(PIN_INFO *pInfo) override;
	STDMETHODIMP QueryDirection(PIN_DIRECTION *pPinDir) override;
	STDMETHODIMP QueryId(LPWSTR *lpId) override;
	STDMETHODIMP QueryAccept(const AM_MEDIA_TYPE *pmt) override;
	STDMETHODIMP EnumMediaTypes(IEnumMediaTypes **ppEnum) override;
	STDMETHODIMP QueryInternalConnections(IPin **apPin, ULONG *nPin) override;
	STDMETHODIMP EndOfStream() override;
	STDMETHODIMP BeginFlush() override;
	STDMETHODIMP EndFlush() override;
	STDMETHODIMP NewSegment(REFERENCE_TIME tStart, REFERENCE_TIME tStop, double dRate) override;

	// IAMStreamConfig
	STDMETHODIMP SetFormat(AM_MEDIA_TYPE *pmt) override;
	STDMETHODIMP GetFormat(AM_MEDIA_TYPE **ppmt) override;
	STDMETHODIMP GetNumberOfCapabilities(int *piCount, int *piSize) override;
	STDMETHODIMP GetStreamCaps(int iIndex, AM_MEDIA_TYPE **ppmt, BYTE *pSCC) override;

	// IKsPropertySet
	STDMETHODIMP Set(REFGUID guidPropSet, DWORD dwPropID, void *pInstanceData, DWORD cbInstanceData,
			 void *pPropData, DWORD cbPropData) override;
	STDMETHODIMP Get(REFGUID guidPropSet, DWORD dwPropID, void *pInstanceData, DWORD cbInstanceData,
			 void *pPropData, DWORD cbPropData, DWORD *pcbReturned) override;
	STDMETHODIMP QuerySupported(REFGUID guidPropSet, DWORD dwPropID, DWORD *pTypeSupport) override;

	// Called by the filter on state transitions. All are idempotent.
	HRESULT CommitAllocator();
	HRESULT StartStreaming();
	void StopStreaming();
	void FlushDownstream();

	// The advertised type at `index`.
	const AM_MEDIA_TYPE *MediaType(int index) const { return &m_mtList[index]; }

	// The currently negotiated type.
	const AM_MEDIA_TYPE *NegotiatedMediaType() const { return &m_mt; }

private:
	~OpticXPin();

	bool AllocateBuffers(IPin *target);
	void ReleaseConnection();
	HRESULT DeliverFrame(IMemInputPin *memInput, IMemAllocator *allocator, REFERENCE_TIME start,
			     REFERENCE_TIME stop, bool first);
	void ConvertFrame(const uint8_t *source, uint8_t *destination, const VCamMediaSpec &spec);

	// Selects one exact advertised capture type. Caller must hold m_lock.
	void SelectMediaType(int index);
	void ThreadProc();
	static DWORD WINAPI ThreadThunk(LPVOID param);

	volatile LONG m_refCount = 0;

	// Back-pointer. The filter outlives the pin and holds the only strong
	// reference to it, so this is deliberately not ref-counted.
	OpticXFilter *m_filter;

	// Every type we advertise, plus a copy of the negotiated one.
	AM_MEDIA_TYPE m_mtList[kVCamMediaTypeCount] = {};
	AM_MEDIA_TYPE m_mt = {};
	int m_mediaTypeIndex = 0;

	CRITICAL_SECTION m_lock;

	IPin *m_connected = nullptr;
	IMemInputPin *m_memInput = nullptr;
	IMemAllocator *m_allocator = nullptr;
	bool m_committed = false;
	volatile LONG m_flushing = 0;

	HANDLE m_thread = nullptr;
	HANDLE m_stopEvent = nullptr;

	ShmFrameReader m_reader;
	uint8_t *m_sourceFrame = nullptr;
};

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

class OpticXFilter : public IBaseFilter, public IAMFilterMiscFlags {
public:
	OpticXFilter();

	// IUnknown
	STDMETHODIMP QueryInterface(REFIID riid, void **ppv) override;
	STDMETHODIMP_(ULONG) AddRef() override;
	STDMETHODIMP_(ULONG) Release() override;

	// IPersist
	STDMETHODIMP GetClassID(CLSID *pClsID) override;

	// IMediaFilter
	STDMETHODIMP GetState(DWORD dwMSecs, FILTER_STATE *State) override;
	STDMETHODIMP SetSyncSource(IReferenceClock *pClock) override;
	STDMETHODIMP GetSyncSource(IReferenceClock **pClock) override;
	STDMETHODIMP Stop() override;
	STDMETHODIMP Pause() override;
	STDMETHODIMP Run(REFERENCE_TIME tStart) override;

	// IBaseFilter
	STDMETHODIMP EnumPins(IEnumPins **ppEnum) override;
	STDMETHODIMP FindPin(LPCWSTR Id, IPin **ppPin) override;
	STDMETHODIMP QueryFilterInfo(FILTER_INFO *pInfo) override;
	STDMETHODIMP JoinFilterGraph(IFilterGraph *pGraph, LPCWSTR pName) override;
	STDMETHODIMP QueryVendorInfo(LPWSTR *pVendorInfo) override;

	// IAMFilterMiscFlags
	STDMETHODIMP_(ULONG) GetMiscFlags() override;

	OpticXPin *Pin() const { return m_pin; }
	FILTER_STATE CurrentState();

private:
	~OpticXFilter();

	volatile LONG m_refCount = 0;
	CRITICAL_SECTION m_lock;

	FILTER_STATE m_state = State_Stopped;
	IFilterGraph *m_graph = nullptr; // weak, per DirectShow convention
	IReferenceClock *m_clock = nullptr;
	OpticXPin *m_pin = nullptr;
};

// ---------------------------------------------------------------------------
// Enumerators
// ---------------------------------------------------------------------------

class OpticXEnumPins : public IEnumPins {
public:
	OpticXEnumPins(OpticXFilter *filter, ULONG cursor);

	STDMETHODIMP QueryInterface(REFIID riid, void **ppv) override;
	STDMETHODIMP_(ULONG) AddRef() override;
	STDMETHODIMP_(ULONG) Release() override;

	STDMETHODIMP Next(ULONG cPins, IPin **ppPins, ULONG *pcFetched) override;
	STDMETHODIMP Skip(ULONG cPins) override;
	STDMETHODIMP Reset() override;
	STDMETHODIMP Clone(IEnumPins **ppEnum) override;

private:
	~OpticXEnumPins();

	volatile LONG m_refCount = 0;
	OpticXFilter *m_filter;
	ULONG m_cursor;
};

class OpticXEnumMediaTypes : public IEnumMediaTypes {
public:
	OpticXEnumMediaTypes(OpticXPin *pin, ULONG cursor);

	STDMETHODIMP QueryInterface(REFIID riid, void **ppv) override;
	STDMETHODIMP_(ULONG) AddRef() override;
	STDMETHODIMP_(ULONG) Release() override;

	STDMETHODIMP Next(ULONG cMediaTypes, AM_MEDIA_TYPE **ppMediaTypes, ULONG *pcFetched) override;
	STDMETHODIMP Skip(ULONG cMediaTypes) override;
	STDMETHODIMP Reset() override;
	STDMETHODIMP Clone(IEnumMediaTypes **ppEnum) override;

private:
	~OpticXEnumMediaTypes();

	volatile LONG m_refCount = 0;
	OpticXPin *m_pin;
	ULONG m_cursor;
};
