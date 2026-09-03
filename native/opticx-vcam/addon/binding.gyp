{
  "targets": [
    {
      "target_name": "opticx_writer",
      "sources": ["writer-addon.cpp"],
      "defines": ["NAPI_VERSION=8"],
      "conditions": [
        ["OS=='win'", {
          "libraries": ["-lkernel32"]
        }]
      ]
    }
  ]
}
