cmake_minimum_required(VERSION 3.20)

# CMP0091: MSVC runtime library selected via CMAKE_MSVC_RUNTIME_LIBRARY.
cmake_policy(SET CMP0091 NEW)

set(CMAKE_GENERATOR_PLATFORM x64 CACHE STRING "" FORCE)

project(opticx-vcam LANGUAGES CXX)

if(NOT WIN32)
    message(FATAL_ERROR "opticx-vcam is a Windows DirectShow filter and only builds on Windows.")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Static CRT so the filter loads inside host apps (Discord, Chrome) that do
# not ship the VC++ redistributable.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded")

add_library(opticx-vcam SHARED
    src/module.cpp
    src/filter.cpp
    src/media-type.cpp
    src/shm-reader.cpp
    src/filter.h
    src/opticx-common.h
    src/shm-reader.h
    opticx-vcam.def
)

set_target_properties(opticx-vcam PROPERTIES
    OUTPUT_NAME "opticx-vcam"
    PREFIX ""
)

target_compile_definitions(opticx-vcam PRIVATE
    WIN32_LEAN_AND_MEAN
    UNICODE
    _UNICODE
    NOMINMAX
    _CRT_SECURE_NO_WARNINGS
)

target_compile_options(opticx-vcam PRIVATE /W4 /permissive- /EHsc)

target_link_libraries(opticx-vcam PRIVATE
    strmiids
    winmm
    ole32
    oleaut32
    uuid
    advapi32
)

option(OPTICX_BUILD_TEST "Build the in-process smoke test harness" OFF)

if(OPTICX_BUILD_TEST)
    add_executable(opticx-smoke-test test/smoke-test.cpp)
    set_target_properties(opticx-smoke-test PROPERTIES CXX_STANDARD 17)
    target_compile_definitions(opticx-smoke-test PRIVATE WIN32_LEAN_AND_MEAN UNICODE _UNICODE NOMINMAX)
    target_compile_options(opticx-smoke-test PRIVATE /W4 /EHsc)
    target_link_libraries(opticx-smoke-test PRIVATE strmiids ole32)
    add_dependencies(opticx-smoke-test opticx-vcam)
endif()
