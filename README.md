# Optic X Studio v1.3.0

Windows desktop client for a phone camera stream, with a DirectShow virtual camera named **OpticX Cam**.

## Scripts

```
npm install
npm run dev
npm run dist       # Build production app and NSIS Windows installer
```

## Production Build & Installer

Running `npm run dist` compiles the virtual camera DirectShow filter (`opticx-vcam.dll`), the native N-API writers, and packages a distributable 64-bit Windows NSIS installer into `release/`.
