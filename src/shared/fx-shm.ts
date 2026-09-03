/** Named shared-memory ring used by the Maxine FX addon and the renderer. */

export const FX_SECTION_IN = 'OpticXFxIn';
export const FX_SECTION_OUT = 'OpticXFxOut';
export const FX_MAGIC = 0x58465058;
export const FX_VERSION = 1;
export const FX_SLOT_COUNT = 4;
export const FX_MAX_WIDTH = 3840;
export const FX_MAX_HEIGHT = 2160;
export const FX_HEADER_SIZE = 256;
export const FX_SLOT_HEADER = 64;
export const FX_SLOT_PAYLOAD = FX_MAX_WIDTH * FX_MAX_HEIGHT * 4;
export const FX_SLOT_STRIDE = FX_SLOT_HEADER + FX_SLOT_PAYLOAD;
export const FX_TOTAL_SIZE = FX_HEADER_SIZE + FX_SLOT_COUNT * FX_SLOT_STRIDE;

export const FX_SLOT_EMPTY = 0;
export const FX_SLOT_FILLED = 1;
export const FX_SLOT_PROCESSING = 2;
export const FX_SLOT_READY = 3;

export const FX_ADDON_PATH = 'native/opticx-fx/build/Release/opticx_fx.node';
