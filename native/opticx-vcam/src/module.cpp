// COM entry points, class factory and self-registration for OpticX Cam.

#include "filter.h"

#include <strsafe.h>

// {A7E3C1D4-5B92-4E68-9F0A-3C7D81B6E255}
const GUID CLSID_OpticXVCam = {0xa7e3c1d4, 0x5b92, 0x4e68, {0x9f, 0x0a, 0x3c, 0x7d, 0x81, 0xb6, 0xe2, 0x55}};

HINSTANCE g_dllInstance = nullptr;

static volatile LONG g_moduleLocks = 0;

void OpticXLockModule()
{
	InterlockedIncrement(&g_moduleLocks);
}

void OpticXUnlockModule()
{
	InterlockedDecrement(&g_moduleLocks);
}

// ===========================================================================
// Class factory
// ===========================================================================

class OpticXFactory : public IClassFactory {
public:
	OpticXFactory() { OpticXLockModule(); }

	STDMETHODIMP QueryInterface(REFIID riid, void **ppv) override
	{
		if (!ppv)
			return E_POINTER;

		if (riid == IID_IUnknown || riid == IID_IClassFactory) {
			*ppv = static_cast<IClassFactory *>(this);
			AddRef();
			return S_OK;
		}

		*ppv = nullptr;
		return E_NOINTERFACE;
	}

	STDMETHODIMP_(ULONG) AddRef() override { return (ULONG)InterlockedIncrement(&m_refCount); }

	STDMETHODIMP_(ULONG) Release() override
	{
		const LONG refs = InterlockedDecrement(&m_refCount);
		if (refs == 0) {
			delete this;
			return 0;
		}
		return (ULONG)refs;
	}

	STDMETHODIMP CreateInstance(IUnknown *outer, REFIID riid, void **ppv) override
	{
		if (!ppv)
			return E_POINTER;

		*ppv = nullptr;

		// Aggregation is not supported.
		if (outer)
			return CLASS_E_NOAGGREGATION;

		OpticXFilter *filter = new (std::nothrow) OpticXFilter();
		if (!filter)
			return E_OUTOFMEMORY;

		// Hold a creation reference so the object destroys itself
		// through Release() whether or not the QI succeeds.
		filter->AddRef();
		const HRESULT hr = filter->QueryInterface(riid, ppv);
		filter->Release();

		return hr;
	}

	STDMETHODIMP LockServer(BOOL lock) override
	{
		if (lock)
			OpticXLockModule();
		else
			OpticXUnlockModule();
		return S_OK;
	}

private:
	~OpticXFactory() { OpticXUnlockModule(); }

	volatile LONG m_refCount = 0;
};

// ===========================================================================
// Registration
// ===========================================================================

static const REGPINTYPES kPinTypes[] = {
	{&MEDIATYPE_Video, &kMediaSubtypeI420},
	{&MEDIATYPE_Video, &MEDIASUBTYPE_NV12},
	{&MEDIATYPE_Video, &MEDIASUBTYPE_YUY2},
};

static const REGFILTERPINS kPin = {
	nullptr,      // strName
	FALSE,        // bRendered
	TRUE,         // bOutput
	FALSE,        // bZero
	FALSE,        // bMany
	&CLSID_NULL,  // clsConnectsToFilter
	nullptr,      // strConnectsToPin
	ARRAYSIZE(kPinTypes),
	kPinTypes,
};

static inline DWORD StringBytes(const wchar_t *str)
{
	return (DWORD)((wcslen(str) + 1) * sizeof(wchar_t));
}

static bool RegisterCoClass()
{
	wchar_t dllPath[MAX_PATH] = {};
	const DWORD len = GetModuleFileNameW(g_dllInstance, dllPath, MAX_PATH);
	if (len == 0 || len >= MAX_PATH)
		return false;

	wchar_t clsidStr[64] = {};
	if (StringFromGUID2(CLSID_OpticXVCam, clsidStr, ARRAYSIZE(clsidStr)) == 0)
		return false;

	wchar_t keyPath[128] = {};
	if (FAILED(StringCchPrintfW(keyPath, ARRAYSIZE(keyPath), L"CLSID\\%s", clsidStr)))
		return false;

	HKEY key = nullptr;
	if (RegCreateKeyExW(HKEY_CLASSES_ROOT, keyPath, 0, nullptr, 0, KEY_WRITE, nullptr, &key, nullptr) !=
	    ERROR_SUCCESS)
		return false;

	bool ok = RegSetValueExW(key, nullptr, 0, REG_SZ, (const BYTE *)OPTICX_FILTER_NAME,
				 StringBytes(OPTICX_FILTER_NAME)) == ERROR_SUCCESS;

	HKEY subkey = nullptr;
	if (ok && RegCreateKeyExW(key, L"InprocServer32", 0, nullptr, 0, KEY_WRITE, nullptr, &subkey, nullptr) ==
			  ERROR_SUCCESS) {
		ok = RegSetValueExW(subkey, nullptr, 0, REG_SZ, (const BYTE *)dllPath, StringBytes(dllPath)) ==
		     ERROR_SUCCESS;
		ok = ok && RegSetValueExW(subkey, L"ThreadingModel", 0, REG_SZ, (const BYTE *)L"Both",
					  StringBytes(L"Both")) == ERROR_SUCCESS;
		RegCloseKey(subkey);
	} else {
		ok = false;
	}

	RegCloseKey(key);
	return ok;
}

static bool UnregisterCoClass()
{
	wchar_t clsidStr[64] = {};
	if (StringFromGUID2(CLSID_OpticXVCam, clsidStr, ARRAYSIZE(clsidStr)) == 0)
		return false;

	wchar_t keyPath[128] = {};
	if (FAILED(StringCchPrintfW(keyPath, ARRAYSIZE(keyPath), L"CLSID\\%s", clsidStr)))
		return false;

	const LSTATUS status = RegDeleteTreeW(HKEY_CLASSES_ROOT, keyPath);
	return status == ERROR_SUCCESS || status == ERROR_FILE_NOT_FOUND;
}

static bool MapFilter(bool reg)
{
	IFilterMapper2 *mapper = nullptr;
	HRESULT hr = CoCreateInstance(CLSID_FilterMapper2, nullptr, CLSCTX_INPROC_SERVER, IID_IFilterMapper2,
				      (void **)&mapper);
	if (FAILED(hr) || !mapper)
		return false;

	if (reg) {
		REGFILTER2 rf = {};
		rf.dwVersion = 1;
		rf.dwMerit = MERIT_DO_NOT_USE + 1;
		rf.cPins = 1;
		rf.rgPins = &kPin;

		IMoniker *moniker = nullptr;
		hr = mapper->RegisterFilter(CLSID_OpticXVCam, OPTICX_FILTER_NAME, &moniker,
					    &CLSID_VideoInputDeviceCategory, nullptr, &rf);
		if (moniker)
			moniker->Release();
	} else {
		hr = mapper->UnregisterFilter(&CLSID_VideoInputDeviceCategory, nullptr, CLSID_OpticXVCam);
		if (hr == VFW_E_NOT_FOUND)
			hr = S_OK;
	}

	mapper->Release();
	return SUCCEEDED(hr);
}

// ===========================================================================
// Exports
// ===========================================================================

STDAPI DllGetClassObject(REFCLSID rclsid, REFIID riid, void **ppv)
{
	if (!ppv)
		return E_POINTER;

	*ppv = nullptr;

	if (!IsEqualCLSID(rclsid, CLSID_OpticXVCam))
		return CLASS_E_CLASSNOTAVAILABLE;

	OpticXFactory *factory = new (std::nothrow) OpticXFactory();
	if (!factory)
		return E_OUTOFMEMORY;

	factory->AddRef();
	const HRESULT hr = factory->QueryInterface(riid, ppv);
	factory->Release();

	return hr;
}

STDAPI DllCanUnloadNow()
{
	return InterlockedCompareExchange(&g_moduleLocks, 0, 0) == 0 ? S_OK : S_FALSE;
}

STDAPI DllRegisterServer()
{
	if (!RegisterCoClass()) {
		UnregisterCoClass();
		return SELFREG_E_CLASS;
	}

	const HRESULT init = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
	const bool mapped = MapFilter(true);
	if (!mapped)
		MapFilter(false);
	if (SUCCEEDED(init))
		CoUninitialize();

	if (!mapped) {
		UnregisterCoClass();
		return SELFREG_E_CLASS;
	}

	return S_OK;
}

STDAPI DllUnregisterServer()
{
	const HRESULT init = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
	const bool unmapped = MapFilter(false);
	if (SUCCEEDED(init))
		CoUninitialize();

	const bool unregistered = UnregisterCoClass();
	return (unmapped && unregistered) ? S_OK : SELFREG_E_CLASS;
}

STDAPI DllInstall(BOOL install, LPCWSTR)
{
	return install ? DllRegisterServer() : DllUnregisterServer();
}

BOOL WINAPI DllMain(HINSTANCE inst, DWORD reason, LPVOID)
{
	if (reason == DLL_PROCESS_ATTACH) {
		g_dllInstance = inst;
		DisableThreadLibraryCalls(inst);
	}

	return TRUE;
}
