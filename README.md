# Optic X Studio v1.2.2

Windows desktop client for a phone camera stream, with a DirectShow virtual camera named **OpticX Cam**.
## AI pipeline

Optional NVIDIA Maxine Video Effects stages (artifact reduction, denoise, super resolution, fast upscale) load the **already-installed** runtime from:

`C:\Program Files\NVIDIA Corporation\NVIDIA Video Effects\`

Nothing from that SDK is bundled or redistributed. Personal use of the local runtime is subject to the NVIDIA Maxine EULA (`NVIDIA Maxine EULA.pdf` in that folder). Do not ship this app with Maxine DLLs or TensorRT engines attached.

RIFE interpolation uses `onnxruntime-web` plus `models/rife_v4.25_lite_v2.onnx` (MIT, fetched by `npm run fetch-models`, gitignored).

`--safe-mode` and an automatic revert to the plain WebGL2 path apply if the previous launch crashed while AI was armed.

## Scripts

```
npm install
npm run fetch-models
npm run build:fx-addon
npm run dev
npm run dist       # Build production app and NSIS Windows installer
```

## Production Build & Installer

Running `npm run dist` compiles the virtual camera DirectShow filter (`opticx-vcam.dll`), the native N-API writers, Maxine FX host, and packages a distributable 64-bit Windows NSIS installer into `release/`.
