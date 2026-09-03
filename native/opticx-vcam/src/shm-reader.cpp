#include "shm-reader.h"

namespace {

constexpr wchar_t kQueueName[] = L"OpticXCamVideo4K";

// Header field byte offsets.
constexpr uint32_t kOffReadIdx = 0x04;
constexpr uint32_t kOffState = 0x08;
constexpr uint32_t kOffOffsets = 0x0C;
constexpr uint32_t kOffCx = 0x1C;
constexpr uint32_t kOffCy = 0x20;
constexpr uint32_t kOffInterval = 0x28;

inline uint32_t LoadU32(const uint8_t *base, uint32_t offset)
{
	// Reads are 4-byte aligned by construction; volatile prevents the
	// compiler from caching a value the producer mutates behind our back.
	return *reinterpret_cast<const volatile uint32_t *>(base + offset);
}

inline uint64_t LoadU64(const uint8_t *base, uint32_t offset)
{
	return *reinterpret_cast<const volatile uint64_t *>(base + offset);
}

} // namespace

void FillBlackNV12(uint8_t *dst)
{
	const size_t lumaSize = (size_t)kVCamWidth * kVCamHeight;
	memset(dst, kBlackLuma, lumaSize);
	memset(dst + lumaSize, kBlackChroma, (size_t)kVCamFrameSize - lumaSize);
}

ShmFrameReader::~ShmFrameReader()
{
	Close();
}

void ShmFrameReader::Close()
{
	if (m_view) {
		UnmapViewOfFile(m_view);
		m_view = nullptr;
	}
	if (m_mapping) {
		CloseHandle(m_mapping);
		m_mapping = nullptr;
	}

	m_viewSize = 0;
	m_lastReadIdx = 0;
	m_haveLastReadIdx = false;
	m_queueInterval = 0;
	m_stallCount = 0;
}

bool ShmFrameReader::TryOpen()
{
	HANDLE mapping = OpenFileMappingW(FILE_MAP_READ, FALSE, kQueueName);
	if (!mapping)
		return false;

	const uint8_t *view = (const uint8_t *)MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0);
	if (!view) {
		CloseHandle(mapping);
		return false;
	}

	MEMORY_BASIC_INFORMATION mbi = {};
	if (VirtualQuery(view, &mbi, sizeof(mbi)) != sizeof(mbi) || mbi.RegionSize < kHeaderSize) {
		UnmapViewOfFile(view);
		CloseHandle(mapping);
		return false;
	}

	m_mapping = mapping;
	m_view = view;
	m_viewSize = mbi.RegionSize;
	m_lastReadIdx = 0;
	m_haveLastReadIdx = false;
	m_stallCount = 0;
	return true;
}

bool ShmFrameReader::CopySlot(uint8_t *dst, uint32_t readIdx)
{
	const uint32_t slot = readIdx % kSlotCount;
	const uint32_t offset = LoadU32(m_view, kOffOffsets + slot * sizeof(uint32_t));

	if (offset < kHeaderSize)
		return false;

	const uint64_t end = (uint64_t)offset + kSlotHeaderSize + kVCamFrameSize;
	if (end > (uint64_t)m_viewSize)
		return false;

	memcpy(dst, m_view + offset + kSlotHeaderSize, kVCamFrameSize);
	return true;
}

bool ShmFrameReader::ReadFrame(uint8_t *dst)
{
	if (!m_view) {
		if (m_reopenCountdown > 0) {
			--m_reopenCountdown;
			FillBlackNV12(dst);
			return false;
		}

		m_reopenCountdown = kReopenPollInterval;
		if (!TryOpen()) {
			FillBlackNV12(dst);
			return false;
		}
	}

	const uint32_t state = LoadU32(m_view, kOffState);

	if (state == kStateStopping) {
		// The producer is going away and a replacement will publish a
		// brand new section object under the same name, so this mapping
		// must be dropped or it would go stale.
		Close();
		m_reopenCountdown = kReopenPollInterval;
		FillBlackNV12(dst);
		return false;
	}

	if (state != kStateReady) {
		// INVALID/STARTING: the producer is coming up in place. Keep the
		// mapping so the very first ready frame is picked up at once.
		m_haveLastReadIdx = false;
		m_stallCount = 0;
		m_queueInterval = 0;
		FillBlackNV12(dst);
		return false;
	}

	if (LoadU32(m_view, kOffCx) != kVCamWidth || LoadU32(m_view, kOffCy) != kVCamHeight) {
		// Geometry mismatch: the filter never scales.
		m_queueInterval = 0;
		FillBlackNV12(dst);
		return false;
	}

	m_queueInterval = LoadU64(m_view, kOffInterval);

	const uint32_t readIdx = LoadU32(m_view, kOffReadIdx);

	if (m_haveLastReadIdx && readIdx == m_lastReadIdx) {
		if (m_stallCount < kStallLimit)
			++m_stallCount;
		// Hold the last live frame. Filling black here is what Discord
		// saw as a black/white flash when the editor was minimized.
	} else {
		m_lastReadIdx = readIdx;
		m_haveLastReadIdx = true;
		m_stallCount = 0;
	}

	MemoryBarrier();

	if (!CopySlot(dst, readIdx)) {
		FillBlackNV12(dst);
		return false;
	}

	return true;
}
