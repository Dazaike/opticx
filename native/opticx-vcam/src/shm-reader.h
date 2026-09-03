// Reader half of the "OpticXCamVideo" shared-memory video queue.
//
// Layout (little-endian, byte offsets exact):
//   0x00 u32 write_idx
//   0x04 u32 read_idx
//   0x08 u32 state       0=INVALID 1=STARTING 2=READY 3=STOPPING
//   0x0C u32 offsets[3]
//   0x18 u32 type        always 0 (video)
//   0x1C u32 cx
//   0x20 u32 cy
//   0x24 u32 pad
//   0x28 u64 interval    frame interval in 100ns units
//   0x30 u32 reserved[8]
// Header size = 0x50. Each slot: u64 timestamp at off+0, NV12 data at off+32.

#pragma once

#include "opticx-common.h"

class ShmFrameReader {
public:
	ShmFrameReader() = default;
	~ShmFrameReader();

	ShmFrameReader(const ShmFrameReader &) = delete;
	ShmFrameReader &operator=(const ShmFrameReader &) = delete;

	// Fills `dst` with exactly kVCamFrameSize NV12 bytes. Returns true when
	// the bytes came from a live producer frame, false when black was
	// synthesised (no producer, wrong geometry, or a stalled queue).
	bool ReadFrame(uint8_t *dst);

	// Frame interval (100ns) advertised by the producer on the most recent
	// live ReadFrame, or 0 when no live producer was seen.
	uint64_t QueueInterval() const { return m_queueInterval; }

	void Close();

private:
	static constexpr uint32_t kHeaderSize = 0x50;
	static constexpr uint32_t kSlotHeaderSize = 32;
	static constexpr uint32_t kSlotCount = 3;
	static constexpr uint32_t kStateReady = 2;
	static constexpr uint32_t kStateStopping = 3;
	static constexpr uint32_t kStallLimit = 10;
	// Polls to skip between OpenFileMappingW retries. Kept small: a failed
	// open is a sub-microsecond syscall, and the producer recreates the
	// section whenever its output rate changes, so a long throttle would
	// show up as a visible black gap on every fps switch.
	static constexpr uint32_t kReopenPollInterval = 3;

	bool TryOpen();
	bool CopySlot(uint8_t *dst, uint32_t readIdx);

	HANDLE m_mapping = nullptr;
	const uint8_t *m_view = nullptr;
	size_t m_viewSize = 0;

	uint32_t m_lastReadIdx = 0;
	bool m_haveLastReadIdx = false;
	uint32_t m_stallCount = 0;
	uint64_t m_queueInterval = 0;
	uint32_t m_reopenCountdown = 0;
};

void FillBlackNV12(uint8_t *dst);
