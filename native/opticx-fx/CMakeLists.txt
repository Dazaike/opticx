cmake_minimum_required(VERSION 3.20)

cmake_policy(SET CMP0091 NEW)

set(CMAKE_GENERATOR_PLATFORM x64 CACHE STRING "" FORCE)

project(opticx-fx LANGUAGES CXX)

if(NOT WIN32)
    message(FATAL_ERROR "opticx-fx is a Windows Maxine addon.")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded")

set(OPTICX_FX_COMMON
    src/NVVideoEffectsProxy.cpp
    src/nvCVImageProxy.cpp
    src/fx-engine.cpp
    src/shm-ring.cpp
)

add_executable(opticx-fx-harness
    test/harness.cpp
    ${OPTICX_FX_COMMON}
)

add_executable(opticx-fx-host
    src/fx-host.cpp
    ${OPTICX_FX_COMMON}
)

set_target_properties(opticx-fx-harness opticx-fx-host PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/Release"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/Release"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/Release"
)

target_include_directories(opticx-fx-harness PRIVATE vendor src)
target_include_directories(opticx-fx-host PRIVATE vendor src)

target_compile_definitions(opticx-fx-harness PRIVATE
    WIN32_LEAN_AND_MEAN UNICODE _UNICODE NOMINMAX _CRT_SECURE_NO_WARNINGS
)
target_compile_definitions(opticx-fx-host PRIVATE
    WIN32_LEAN_AND_MEAN UNICODE _UNICODE NOMINMAX _CRT_SECURE_NO_WARNINGS
)

target_compile_options(opticx-fx-harness PRIVATE /W4 /permissive- /EHsc /utf-8)
target_compile_options(opticx-fx-host PRIVATE /W4 /permissive- /EHsc /utf-8)

# The N-API addon is built by node-gyp (scripts/build-opticx-fx.mjs) so it gets
# the Windows delay-load hook Electron requires. CMake owns only the standalone
# Maxine processes below.
