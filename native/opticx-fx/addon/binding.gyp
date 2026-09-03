{
  "targets": [
    {
      "target_name": "opticx_fx",
      "sources": ["../src/addon.cpp", "../src/shm-ring.cpp"],
      "include_dirs": [
        "../vendor",
        "../src",
        "<!(node -p \"require('node-addon-api').include_dir\")"
      ],
      "defines": ["NAPI_VERSION=8", "WIN32_LEAN_AND_MEAN", "NOMINMAX", "_CRT_SECURE_NO_WARNINGS"],
      "cflags_cc!": ["-fno-exceptions"],
      "conditions": [
        ["OS=='win'", {
          "libraries": ["-lkernel32"],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/utf-8"]
            }
          }
        }]
      ]
    }
  ]
}
