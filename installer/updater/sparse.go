package main

// Android sparse image writer, from AOSP system/core/libsparse/sparse_format.h:
//   sparse_header: u32 magic 0xed26ff3a, u16 major 1, u16 minor, u16 file_hdr_sz, u16 chunk_hdr_sz,
//                  u32 blk_sz, u32 total_blks, u32 total_chunks, u32 image_checksum
//   chunk_header:  u16 type (0xCAC1 raw, 0xCAC2 fill, 0xCAC3 dont care, 0xCAC4 crc32),
//                  u16 reserved, u32 chunk_sz (blocks), u32 total_sz (bytes incl. header)

import (
	"encoding/binary"
	"fmt"
	"io"
)

const (
	sparseMagic   = 0xed26ff3a
	chunkRaw      = 0xcac1
	chunkFill     = 0xcac2
	chunkDontCare = 0xcac3
	chunkCRC32    = 0xcac4
)

// Region is a run of output bytes written to the device.
type Region struct {
	Offset int64
	Length int64
}

// SparseWriter receives the expanded data.
type SparseWriter interface {
	// WriteRegion writes data at off. Fill chunks call it with repeated pattern data.
	WriteRegion(off int64, data []byte) error
}

// IsSparse reports whether the first bytes are a sparse header.
func IsSparse(head []byte) bool {
	return len(head) >= 4 && binary.LittleEndian.Uint32(head) == sparseMagic
}

// WriteSparse streams a sparse image to w and returns the total output size and the regions
// that were written (raw and fill chunks; dont-care chunks are skipped like fastboot does).
func WriteSparse(r io.Reader, w SparseWriter, chunkBuf int) (int64, []Region, error) {
	hdr := make([]byte, 28)
	if _, err := io.ReadFull(r, hdr); err != nil {
		return 0, nil, fmt.Errorf("sparse header: %w", err)
	}
	if binary.LittleEndian.Uint32(hdr) != sparseMagic {
		return 0, nil, fmt.Errorf("not a sparse image")
	}
	if major := binary.LittleEndian.Uint16(hdr[4:]); major != 1 {
		return 0, nil, fmt.Errorf("unsupported sparse major version %d", major)
	}
	fileHdr := int(binary.LittleEndian.Uint16(hdr[8:]))
	chunkHdr := int(binary.LittleEndian.Uint16(hdr[10:]))
	blk := int64(binary.LittleEndian.Uint32(hdr[12:]))
	totalBlks := int64(binary.LittleEndian.Uint32(hdr[16:]))
	totalChunks := int(binary.LittleEndian.Uint32(hdr[20:]))
	if fileHdr < 28 || chunkHdr < 12 || blk == 0 || blk%4 != 0 {
		return 0, nil, fmt.Errorf("bad sparse header sizes")
	}
	if _, err := io.CopyN(io.Discard, r, int64(fileHdr-28)); err != nil {
		return 0, nil, err
	}
	var regions []Region
	var block int64
	ch := make([]byte, chunkHdr)
	buf := make([]byte, chunkBuf)
	for i := 0; i < totalChunks; i++ {
		if _, err := io.ReadFull(r, ch); err != nil {
			return 0, nil, fmt.Errorf("chunk %d header: %w", i, err)
		}
		typ := binary.LittleEndian.Uint16(ch)
		size := int64(binary.LittleEndian.Uint32(ch[4:]))
		total := int64(binary.LittleEndian.Uint32(ch[8:]))
		out := size * blk
		off := block * blk
		switch typ {
		case chunkRaw:
			if total != int64(chunkHdr)+out {
				return 0, nil, fmt.Errorf("chunk %d: bad raw size", i)
			}
			for done := int64(0); done < out; {
				n := int64(len(buf))
				if out-done < n {
					n = out - done
				}
				if _, err := io.ReadFull(r, buf[:n]); err != nil {
					return 0, nil, fmt.Errorf("chunk %d data: %w", i, err)
				}
				if err := w.WriteRegion(off+done, buf[:n]); err != nil {
					return 0, nil, err
				}
				done += n
			}
			regions = append(regions, Region{off, out})
		case chunkFill:
			if total != int64(chunkHdr)+4 {
				return 0, nil, fmt.Errorf("chunk %d: bad fill size", i)
			}
			pat := make([]byte, 4)
			if _, err := io.ReadFull(r, pat); err != nil {
				return 0, nil, err
			}
			n := len(buf) - len(buf)%4
			for k := 0; k < n; k += 4 {
				copy(buf[k:], pat)
			}
			for done := int64(0); done < out; {
				m := int64(n)
				if out-done < m {
					m = out - done
				}
				if err := w.WriteRegion(off+done, buf[:m]); err != nil {
					return 0, nil, err
				}
				done += m
			}
			regions = append(regions, Region{off, out})
		case chunkDontCare:
			if total != int64(chunkHdr) {
				return 0, nil, fmt.Errorf("chunk %d: bad dont-care size", i)
			}
		case chunkCRC32:
			if _, err := io.CopyN(io.Discard, r, total-int64(chunkHdr)); err != nil {
				return 0, nil, err
			}
		default:
			return 0, nil, fmt.Errorf("chunk %d: unknown type 0x%x", i, typ)
		}
		block += size
	}
	if block != totalBlks {
		return 0, nil, fmt.Errorf("chunks cover %d blocks, header says %d", block, totalBlks)
	}
	return totalBlks * blk, regions, nil
}
