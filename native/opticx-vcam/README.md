# opticx-vcam

A Windows x64 DirectShow **push source** video capture filter that exposes a
webcam device named **OpticX Cam**. Any DirectShow capture app (Discord,
Chrome/Chromium, OBS, ffmpeg's `dshow` input, GraphEdit) can select it as a
camera.

The filter is the *reader* half of a shared-memory video queue. The *writer*
half lives in the Electron main process, which scales the phone's video down
to 1920x1080 NV12 and publishes frames into the queue. When no producer is
present the filter emits solid black frames, so the device always works and
never breaks the host app.

The Windows 10/11 SDK no longer ships the DirectShow BaseClasses
(`strmbase`), so every COM interface here is implemented directly:
`IBaseFilter` (via `IMediaFilter`/`IPersist`), `IAMFilterMiscFlags`,
`IEnumPins`, and on the output pin `IPin`, `IAMStreamConfig`,
`IKsPropertySet` and `IEnumMediaTypes`.

## Contract

### Identity

| | |
|---|---|
| Friendly name | `OpticX Cam` |
| Filter CLSID | `{A7E3C1D4-5B92-4E68-9F0A-3C7D81B6E255}` |
| Category | `CLSID_VideoInputDeviceCategory` |
| Merit | `MERIT_DO_NOT_USE + 1` |

### Media types

Two types are advertised, both `MEDIATYPE_Video` / `MEDIASUBTYPE_NV12` /
`FORMAT_VideoInfo` at a fixed 1920x1080 (`biBitCount=12`,
`biCompression='NV12'`, `biSizeImage=3110400`, `lSampleSize=3110400`,
`bFixedSizeSamples=TRUE`, `bTemporalCompression=FALSE`):

| Index | `AvgTimePerFrame` | Rate |
|---|---|---|
| 0 | `333333` | 30 fps (default) |
| 1 | `166666` | 60 fps |

`IAMStreamConfig::GetNumberOfCapabilities` reports 2; every
`VIDEO_STREAM_CONFIG_CAPS` entry spans `MinFrameInterval=166666` ..
`MaxFrameInterval=333333`. `GetFormat` reports 30 fps until a peer calls
`SetFormat`. The filter **never scales** — the producer owns all resizing and
letterboxing.

### Shared-memory queue

Session-local named section `OpticXCamVideo`, opened `FILE_MAP_READ`. Header
is 0x50 bytes, little-endian:

```
0x00 u32 write_idx
0x04 u32 read_idx
0x08 u32 state        // 0=INVALID 1=STARTING 2=READY 3=STOPPING
0x0C u32 offsets[3]
0x18 u32 type         // always 0 (video)
0x1C u32 cx           // must be 1920
0x20 u32 cy           // must be 1080
0x24 u32 pad
0x28 u64 interval     // 100ns frame interval: 333333 or 166666
0x30 u32 reserved[8]
```

Sizing (`ALIGN32(v) = (v + 31) & ~31`, `frame_size = cx*cy*3/2 = 3110400`):

```
size = ALIGN32(80) = 96
for i in 0..2: offsets[i] = size; size = ALIGN32(size + frame_size + 32)
```

which yields `offsets = {96, 3110528, 6220960}` and `totalSize = 9331392`.
Each slot holds a `u64` timestamp at `off + 0` and `frame_size` NV12 bytes at
`off + 32`. NV12 is a full-resolution Y plane (stride `cx`) followed by an
interleaved `U V U V ...` plane of `cy/2` rows, BT.601 limited range.

### Reader behaviour

The filter emits solid black NV12 (`Y=0x10`, `U=V=0x80`) whenever it cannot
serve a real frame:

* `OpenFileMappingW` fails (no producer).
* `state` is `INVALID` or `STARTING` — the mapping is **kept open** so the
  first ready frame is picked up immediately.
* `state` is `STOPPING` — the mapping is dropped, since a replacement
  producer publishes a brand new section object under the same name.
* `cx`/`cy` are not 1920x1080.
* `read_idx` has not advanced for 10 consecutive polls (stalled producer),
  until it advances again.

Pacing follows the header's `interval` when it is `333333` or `166666`; any
other value is clamped to the negotiated media type's `AvgTimePerFrame`. The
filter never pushes faster than the negotiated rate, so a 60 fps queue feeding
a 30 fps negotiation simply drops frames, while a 30 fps queue feeding a 60 fps
negotiation is followed at 30 fps.

## Build

Requires MSVC (Build Tools 2022 or Visual Studio) and the Windows SDK. The
static CRT is linked in (`/MT`) so the DLL loads inside hosts such as Discord
that do not ship the VC++ redistributable.

```sh
cmake -S native/opticx-vcam -B native/opticx-vcam/build -G "Visual Studio 17 2022" -A x64
cmake --build native/opticx-vcam/build --config Release
```

Output: `native/opticx-vcam/build/Release/opticx-vcam.dll`.

## Register / unregister

`DllRegisterServer` writes the DLL's *own* current path into
`HKCR\CLSID\{...}\InprocServer32`, so **move the DLL to its final location
before registering**, and re-register if you move it. Both commands need an
elevated (Administrator) shell.

```sh
regsvr32 "C:\path\to\opticx-vcam.dll"
regsvr32 /u "C:\path\to\opticx-vcam.dll"
```

Registration does two things, and unregistration reverses both:

1. `HKCR\CLSID\{A7E3C1D4-...}\InprocServer32` = DLL path, with
   `ThreadingModel=Both`.
2. `IFilterMapper2::RegisterFilter` under `CLSID_VideoInputDeviceCategory`
   with friendly name `OpticX Cam` and one NV12 output pin.

Apps enumerate cameras at startup, so restart the host app after
(un)registering.

## Smoke test

An in-process harness connects a stub sink pin to the filter and verifies the
COM plumbing, the advertised media types, the black-frame fallback, and every
pacing rule against a real producer:

```sh
cmake -S native/opticx-vcam -B native/opticx-vcam/build -DOPTICX_BUILD_TEST=ON
cmake --build native/opticx-vcam/build --config Release
native/opticx-vcam/build/Release/opticx-smoke-test.exe
```

It needs no registration and no elevation — it loads the DLL directly and
calls `DllGetClassObject`.

## Layout

| File | Purpose |
|---|---|
| `src/opticx-common.h` | Geometry/rate constants, CLSID, media-type helper declarations |
| `src/media-type.cpp` | `AM_MEDIA_TYPE` build/copy/free helpers (no `strmbase`) |
| `src/shm-reader.h/.cpp` | Reader half of the `OpticXCamVideo` queue |
| `src/filter.h/.cpp` | Filter, output pin, enumerators, streaming thread |
| `src/module.cpp` | Class factory, DLL exports, self-registration |
| `opticx-vcam.def` | Exported entry points |
| `test/smoke-test.cpp` | In-process smoke test |
