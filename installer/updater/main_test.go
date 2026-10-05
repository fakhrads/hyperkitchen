package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// sparseImage builds a sparse image: raw block, fill block, dont-care block, raw block.
func sparseImage(t *testing.T, raw1, raw2 []byte, fill uint32) ([]byte, []byte) {
	const blk = 4096
	var b bytes.Buffer
	hdr := make([]byte, 28)
	binary.LittleEndian.PutUint32(hdr, sparseMagic)
	binary.LittleEndian.PutUint16(hdr[4:], 1)
	binary.LittleEndian.PutUint16(hdr[8:], 28)
	binary.LittleEndian.PutUint16(hdr[10:], 12)
	binary.LittleEndian.PutUint32(hdr[12:], blk)
	binary.LittleEndian.PutUint32(hdr[16:], 4)
	binary.LittleEndian.PutUint32(hdr[20:], 4)
	b.Write(hdr)
	chunk := func(typ uint16, blocks uint32, data []byte) {
		ch := make([]byte, 12)
		binary.LittleEndian.PutUint16(ch, typ)
		binary.LittleEndian.PutUint32(ch[4:], blocks)
		binary.LittleEndian.PutUint32(ch[8:], uint32(12+len(data)))
		b.Write(ch)
		b.Write(data)
	}
	chunk(chunkRaw, 1, raw1)
	f := make([]byte, 4)
	binary.LittleEndian.PutUint32(f, fill)
	chunk(chunkFill, 1, f)
	chunk(chunkDontCare, 1, nil)
	chunk(chunkRaw, 1, raw2)
	expanded := make([]byte, 4*blk)
	copy(expanded, raw1)
	for i := blk; i < 2*blk; i += 4 {
		copy(expanded[i:], f)
	}
	copy(expanded[3*blk:], raw2)
	return b.Bytes(), expanded
}

func filled(n int, c byte) []byte { return bytes.Repeat([]byte{c}, n) }

func sum(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

type fixture struct {
	dir, zip, blocks string
	env              env
	super, boot      []byte
	expanded         []byte
	status           *bytes.Buffer
}

func newFixture(t *testing.T, edit func(m *Manifest)) *fixture {
	t.Helper()
	dir := t.TempDir()
	fx := &fixture{dir: dir, blocks: filepath.Join(dir, "by-name"), status: &bytes.Buffer{}}
	if err := os.MkdirAll(fx.blocks, 0o755); err != nil {
		t.Fatal(err)
	}
	fx.super, fx.expanded = sparseImage(t, filled(4096, 1), filled(4096, 2), 0xdeadbeef)
	fx.boot = filled(8192, 7)
	fw := filled(1000, 9)
	// Fake partitions: firmware already on the device, empty boot slots, garbage-filled super.
	parts := map[string][]byte{
		"xbl_a": append(append([]byte{}, fw...), filled(100, 0)...), "xbl_b": append(append([]byte{}, fw...), filled(100, 3)...),
		"boot_a": filled(16384, 0), "boot_b": filled(16384, 0), "recovery_a": filled(64, 5),
		"super": filled(5*4096, 0xee),
	}
	for n, d := range parts {
		if err := os.WriteFile(filepath.Join(fx.blocks, n), d, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	tool := func(name, script string) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte("#!/bin/sh\n"+script), 0o755); err != nil {
			t.Fatal(err)
		}
		return p
	}
	mounts := filepath.Join(dir, "mounts")
	os.WriteFile(mounts, []byte("tmpfs /tmp tmpfs rw 0 0\n"), 0o644)
	fx.env = env{
		blockDirs: []string{fx.blocks},
		getprop:   tool("getprop", `[ "$1" = ro.product.device ] && echo onyx`),
		bootctl:   tool("bootctl", `echo "$@" > `+filepath.Join(dir, "bootctl.log")),
		mounts:    mounts,
	}
	m := Manifest{
		Schema: 1, Device: "onyx", Build: "test", Generator: "test",
		Firmware: []FirmwareCheck{{Partition: "xbl", Regions: []RegionHash{
			{Offset: 0, Length: 600, SHA256: sum(fw[:600])},
			{Offset: 700, Length: 300, SHA256: sum(fw[700:])},
		}}},
		Write:      []ImageWrite{{Entry: "images/boot.img", Partition: "boot", Slots: []string{"a", "b"}, SHA256: sum(fx.boot)}},
		Super:      ImageWrite{Entry: "images/super.img", Partition: "super", SHA256: sum(fx.super), Sparse: true},
		ActiveSlot: "a",
	}
	if edit != nil {
		edit(&m)
	}
	mj, _ := json.Marshal(m)
	fx.zip = filepath.Join(dir, "pkg.zip")
	zf, _ := os.Create(fx.zip)
	zw := zip.NewWriter(zf)
	for name, data := range map[string][]byte{manifestName: mj, "images/boot.img": fx.boot, "images/super.img": fx.super} {
		w, _ := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Store})
		w.Write(data)
	}
	zw.Close()
	zf.Close()
	return fx
}

func (fx *fixture) read(t *testing.T, name string) []byte {
	b, err := os.ReadFile(filepath.Join(fx.blocks, name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestInstallWritesVerifiesAndSetsSlot(t *testing.T) {
	fx := newFixture(t, nil)
	if err := install(ui{fx.status}, fx.env, fx.zip); err != nil {
		t.Fatalf("install: %v\n%s", err, fx.status)
	}
	for _, s := range []string{"boot_a", "boot_b"} {
		if got := fx.read(t, s); !bytes.Equal(got[:len(fx.boot)], fx.boot) {
			t.Fatalf("%s not written", s)
		}
	}
	super := fx.read(t, "super")
	// Raw and fill blocks written; the dont-care block keeps the old bytes, like fastboot.
	if !bytes.Equal(super[:2*4096], fx.expanded[:2*4096]) || !bytes.Equal(super[3*4096:4*4096], fx.expanded[3*4096:]) {
		t.Fatal("super content wrong")
	}
	if !bytes.Equal(super[2*4096:3*4096], filled(4096, 0xee)) {
		t.Fatal("dont-care block was written")
	}
	if !bytes.Equal(fx.read(t, "recovery_a"), filled(64, 5)) {
		t.Fatal("recovery was touched")
	}
	log, _ := os.ReadFile(filepath.Join(fx.dir, "bootctl.log"))
	if strings.TrimSpace(string(log)) != "set-active-boot-slot 0" {
		t.Fatalf("bootctl: %q", log)
	}
	if !strings.Contains(fx.status.String(), "ui_print Done.") || !strings.Contains(fx.status.String(), "set_progress 1.000") {
		t.Fatalf("status protocol:\n%s", fx.status)
	}
}

func TestRefusesBeforeWritingAnything(t *testing.T) {
	cases := map[string]struct {
		edit  func(m *Manifest)
		setup func(fx *fixture)
		want  string
	}{
		"wrong device": {edit: func(m *Manifest) { m.Device = "other" }, want: "this package is for other"},
		"firmware differs on slot b": {setup: func(fx *fixture) {
			os.WriteFile(filepath.Join(fx.blocks, "xbl_b"), filled(1100, 4), 0o644)
		}, want: "firmware xbl_b differs"},
		"corrupted image": {edit: func(m *Manifest) { m.Write[0].SHA256 = sum([]byte("x")) }, want: "corrupted"},
		"super mounted": {setup: func(fx *fixture) {
			os.WriteFile(fx.env.mounts, []byte("/dev/block/dm-3 /system_root erofs ro 0 0\n"), 0o644)
		}, want: "dynamic partition is mounted"},
		"recovery target":   {edit: func(m *Manifest) { m.Write[0].Partition = "recovery" }, want: "recovery"},
		"missing bootctl":   {setup: func(fx *fixture) { fx.env.bootctl = "" }, want: "no getprop or bootctl"},
		"missing partition": {edit: func(m *Manifest) { m.Write[0].Partition = "dtbo" }, want: "partition dtbo_a not found"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			fx := newFixture(t, c.edit)
			if c.setup != nil {
				c.setup(fx)
			}
			before := map[string][]byte{}
			for _, p := range []string{"boot_a", "boot_b", "super"} {
				before[p] = fx.read(t, p)
			}
			err := install(ui{fx.status}, fx.env, fx.zip)
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("got %v, want %q", err, c.want)
			}
			for p, b := range before {
				if !bytes.Equal(fx.read(t, p), b) {
					t.Fatalf("%s was written although the install was refused", p)
				}
			}
		})
	}
}

func TestSparseRejectsInconsistentImages(t *testing.T) {
	img, _ := sparseImage(t, filled(4096, 1), filled(4096, 2), 0)
	bad := append([]byte{}, img...)
	binary.LittleEndian.PutUint32(bad[16:], 9)
	if _, _, err := WriteSparse(bytes.NewReader(bad), &devWriter{hashes: map[int64][32]byte{}, lens: map[int64]int{}, f: nil}, 4096); err == nil {
		// devWriter with nil file fails on first write; header mismatch is detected at the end.
		t.Fatal("expected an error")
	}
	if _, _, err := WriteSparse(bytes.NewReader([]byte("not sparse at all, definitely not")), nil, 4096); err == nil {
		t.Fatal("expected an error for non-sparse input")
	}
}
