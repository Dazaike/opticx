#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

bool MaxineRuntimeLoaded();
const wchar_t* MaxineRuntimeDirW();
HMODULE MaxineCvModule();
