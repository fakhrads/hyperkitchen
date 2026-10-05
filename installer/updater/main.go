// HyperKitchen update-binary for custom recoveries (TWRP, OrangeFox).
//
// Recovery protocol (TWRP twrpinstall/installcommand.cpp update_binary_command and
// twinstall.cpp Run_Update_Binary): argv = [binary, api_version, status_fd, zip_path];
// status lines on status_fd: "ui_print <text>", "progress <fraction> <seconds>",
// "set_progress <fraction>"; a non-zero exit status fails the install.
//
// Safety order: every check runs before the first write. Nothing is written when the device,
// the recovery tools, the firmware already on the device (both slots) or any image in the zip
// does not match the manifest. Every write is read back and compared. The recovery partition
// and the bootloader firmware are never written.
package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

const manifestName = "hk-install.json"

// Manifest is written by HyperKitchen next to the images (see src/worker/package.ts).
type Manifest struct {
	Schema    int    `json:"schema"`
	Device    string `json:"device"`
	Build     string `json:"build"`
	Generator string `json:"generator"`
	// Firmware that must already be on the device, on both slots, before installing.
	Firmware []FirmwareCheck `json:"firmware"`
	// Images written to the given slots of a partition.
	Write []ImageWrite `json:"write"`
	// The super image (sparse) written to the super partition.
	Super      ImageWrite `json:"super"`
	ActiveSlot string     `json:"activeSlot"`
}

type FirmwareCheck struct {
	Partition string `json:"partition"`
	// Byte ranges fastboot writes for this image (one for a raw image, the raw and fill
	// chunks of a sparse one) and their expected SHA-256.
	Regions []RegionHash `json:"regions"`
}

type RegionHash struct {
	Offset int64  `json:"offset"`
	Length int64  `json:"length"`
	SHA256 string `json:"sha256"`
}

type ImageWrite struct {
	Entry     string   `json:"entry"`
	Partition string   `json:"partition"`
	Slots     []string `json:"slots"`
	SHA256    string   `json:"sha256"`
	Sparse    bool     `json:"sparse"`
}

type ui struct{ w io.Writer }

func (u ui) print(format string, a ...any) {
	for _, line := range strings.Split(fmt.Sprintf(format, a...), "\n") {
		fmt.Fprintf(u.w, "ui_print %s\nui_print\n", line)
	}
}
func (u ui) progress(frac float64, secs int) { fmt.Fprintf(u.w, "progress %.3f %d\n", frac, secs) }
func (u ui) setProgress(frac float64)        { fmt.Fprintf(u.w, "set_progress %.3f\n", frac) }

// env holds everything that touches the device, so tests can point it at files.
type env struct {
	blockDirs []string
	getprop   string
	bootctl   string
	mounts    string
}

func defaultEnv() env {
	e := env{
		blockDirs: []string{"/dev/block/bootdevice/by-name", "/dev/block/by-name"},
		getprop:   firstExisting("/system/bin/getprop", "/sbin/getprop", "/bin/getprop"),
		bootctl:   firstExisting("/system/bin/bootctl", "/sbin/bootctl", "/bin/bootctl"),
		mounts:    "/proc/mounts",
	}
	if d := os.Getenv("HK_UPDATER_BLOCK_DIR"); d != "" {
		e.blockDirs = []string{d}
	}
	if p := os.Getenv("HK_UPDATER_GETPROP"); p != "" {
		e.getprop = p
	}
	if p := os.Getenv("HK_UPDATER_BOOTCTL"); p != "" {
		e.bootctl = p
	}
	if p := os.Getenv("HK_UPDATER_MOUNTS"); p != "" {
		e.mounts = p
	}
	return e
}

func firstExisting(paths ...string) string {
	for _, p := range paths {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

func (e env) blockDevice(name string) (string, error) {
	for _, d := range e.blockDirs {
		p := filepath.Join(d, name)
		if _, err := os.Stat(p); err == nil {
			return p, nil
		}
	}
	return "", fmt.Errorf("partition %s not found", name)
}

func (e env) prop(key string) (string, error) {
	out, err := exec.Command(e.getprop, key).Output()
	if err != nil {
		return "", fmt.Errorf("getprop %s: %w", key, err)
	}
	return strings.TrimSpace(string(out)), nil
}

func main() {
	if len(os.Args) < 4 {
		fmt.Fprintln(os.Stderr, "usage: update-binary <api> <status-fd> <zip>")
		os.Exit(2)
	}
	fd, err := strconv.Atoi(os.Args[2])
	if err != nil {
		fmt.Fprintln(os.Stderr, "bad status fd")
		os.Exit(2)
	}
	out := os.NewFile(uintptr(fd), "status")
	u := ui{out}
	if err := install(u, defaultEnv(), os.Args[3]); err != nil {
		u.print("")
		u.print("ERROR: %v", err)
		u.print("Nothing after this point was written.")
		os.Exit(1)
	}
}

func readManifest(z *zip.Reader) (*Manifest, error) {
	f, err := z.Open(manifestName)
	if err != nil {
		return nil, fmt.Errorf("%s missing: not a HyperKitchen package", manifestName)
	}
	defer f.Close()
	var m Manifest
	dec := json.NewDecoder(f)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&m); err != nil {
		return nil, fmt.Errorf("%s: %w", manifestName, err)
	}
	if m.Schema != 1 {
		return nil, fmt.Errorf("unsupported manifest schema %d", m.Schema)
	}
	if m.Device == "" || m.Super.Entry == "" || m.ActiveSlot != "a" && m.ActiveSlot != "b" {
		return nil, errors.New("incomplete manifest")
	}
	for _, w := range append([]ImageWrite{m.Super}, m.Write...) {
		if strings.HasPrefix(w.Partition, "recovery") {
			return nil, errors.New("refusing to write the recovery partition")
		}
	}
	return &m, nil
}

func hashEntry(z *zip.Reader, name string) (string, error) {
	f, err := z.Open(name)
	if err != nil {
		return "", fmt.Errorf("%s missing from the zip", name)
	}
	defer f.Close()
	h := sha256.New()
	// archive/zip checks the CRC-32 when the entry is read to the end.
	if _, err := io.Copy(h, f); err != nil {
		return "", fmt.Errorf("%s: %w", name, err)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func hashDevice(path string, size int64) (string, error) {
	return hashDeviceAt(path, 0, size)
}

func hashDeviceAt(path string, off, size int64) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, io.NewSectionReader(f, off, size))
	if err != nil || n != size {
		return "", fmt.Errorf("%s: read %d of %d bytes at %d: %v", path, n, size, off, err)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func deviceSize(path string) (int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	return f.Seek(0, io.SeekEnd)
}

func superInUse(mounts string) (bool, string) {
	f, err := os.Open(mounts)
	if err != nil {
		return true, "cannot read " + mounts
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	for s.Scan() {
		src := strings.Fields(s.Text())
		if len(src) > 1 && (strings.HasPrefix(src[0], "/dev/block/dm-") || strings.HasPrefix(src[0], "/dev/block/mapper/")) {
			return true, src[0] + " on " + src[1]
		}
	}
	return false, ""
}

func install(u ui, e env, zipPath string) error {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("open package: %w", err)
	}
	defer zr.Close()
	z := &zr.Reader
	m, err := readManifest(z)
	if err != nil {
		return err
	}
	u.print("HyperKitchen installer")
	u.print("Build %s (%s)", m.Build, m.Generator)

	// ---- checks, nothing is written here
	u.progress(0.25, 0)
	if e.getprop == "" || e.bootctl == "" {
		return errors.New("this recovery has no getprop or bootctl; use the fastboot scripts instead")
	}
	device, err := e.prop("ro.product.device")
	if err != nil {
		return err
	}
	if device != m.Device {
		return fmt.Errorf("this package is for %s, the device is %q", m.Device, device)
	}
	if busy, what := superInUse(e.mounts); busy {
		return fmt.Errorf("a dynamic partition is mounted (%s); unmount System/Vendor in the recovery and retry", what)
	}
	u.print("Checking firmware on both slots...")
	for _, fw := range m.Firmware {
		for _, slot := range []string{"a", "b"} {
			dev, err := e.blockDevice(fw.Partition + "_" + slot)
			if err != nil {
				return err
			}
			if len(fw.Regions) == 0 {
				return fmt.Errorf("firmware check for %s has no regions", fw.Partition)
			}
			for _, r := range fw.Regions {
				got, err := hashDeviceAt(dev, r.Offset, r.Length)
				if err != nil {
					return err
				}
				if got != r.SHA256 {
					return fmt.Errorf("firmware %s_%s differs from the base ROM; flash the package with the fastboot script first", fw.Partition, slot)
				}
			}
		}
	}
	u.print("Verifying package contents...")
	images := append([]ImageWrite{}, m.Write...)
	images = append(images, m.Super)
	for i, w := range images {
		got, err := hashEntry(z, w.Entry)
		if err != nil {
			return err
		}
		if got != w.SHA256 {
			return fmt.Errorf("%s is corrupted (sha256 mismatch); download the package again", w.Entry)
		}
		u.setProgress(float64(i+1) / float64(len(images)))
	}
	for _, w := range m.Write {
		for _, slot := range w.Slots {
			if _, err := e.blockDevice(w.Partition + "_" + slot); err != nil {
				return err
			}
		}
	}
	superDev, err := e.blockDevice(m.Super.Partition)
	if err != nil {
		return err
	}

	// ---- writes
	u.print("Flashing boot images...")
	u.progress(0.15, 0)
	for i, w := range m.Write {
		for _, slot := range w.Slots {
			dev, _ := e.blockDevice(w.Partition + "_" + slot)
			if err := writeRaw(z, w.Entry, dev); err != nil {
				return fmt.Errorf("%s_%s: %w", w.Partition, slot, err)
			}
		}
		u.setProgress(float64(i+1) / float64(len(m.Write)))
	}
	u.print("Flashing super (this takes a while)...")
	u.progress(0.55, 0)
	if err := writeSuper(z, m.Super.Entry, superDev, func(f float64) { u.setProgress(f) }); err != nil {
		return fmt.Errorf("super: %w", err)
	}
	u.progress(0.05, 0)
	slot := map[string]string{"a": "0", "b": "1"}[m.ActiveSlot]
	if out, err := exec.Command(e.bootctl, "set-active-boot-slot", slot).CombinedOutput(); err != nil {
		return fmt.Errorf("bootctl set-active-boot-slot %s: %v %s", slot, err, bytes.TrimSpace(out))
	}
	u.setProgress(1)
	u.print("Done. Reboot to system.")
	return nil
}

// writeRaw writes a raw image to a partition, then reads it back and compares.
func writeRaw(z *zip.Reader, entry, dev string) error {
	f, err := z.Open(entry)
	if err != nil {
		return err
	}
	defer f.Close()
	st, _ := f.Stat()
	size, err := deviceSize(dev)
	if err != nil {
		return err
	}
	if st.Size() > size {
		return fmt.Errorf("image is %d bytes, partition is %d", st.Size(), size)
	}
	out, err := os.OpenFile(dev, os.O_WRONLY, 0)
	if err != nil {
		return err
	}
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(out, h), f)
	if err == nil {
		err = out.Sync()
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	back, err := hashDevice(dev, n)
	if err != nil {
		return err
	}
	if back != hex.EncodeToString(h.Sum(nil)) {
		return errors.New("read-back verification failed")
	}
	return nil
}

type devWriter struct {
	f      *os.File
	hashes map[int64][32]byte
	lens   map[int64]int
}

func (d *devWriter) WriteRegion(off int64, data []byte) error {
	if _, err := d.f.WriteAt(data, off); err != nil {
		return err
	}
	d.hashes[off] = sha256.Sum256(data)
	d.lens[off] = len(data)
	return nil
}

type progressReader struct {
	r     io.Reader
	done  int64
	total int64
	cb    func(float64)
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.done += int64(n)
	if p.total > 0 {
		p.cb(0.9 * float64(p.done) / float64(p.total))
	}
	return n, err
}

// writeSuper expands the sparse super image onto the partition, then reads every written
// piece back and compares its hash.
func writeSuper(z *zip.Reader, entry, dev string, progress func(float64)) error {
	f, err := z.Open(entry)
	if err != nil {
		return err
	}
	defer f.Close()
	st, _ := f.Stat()
	size, err := deviceSize(dev)
	if err != nil {
		return err
	}
	out, err := os.OpenFile(dev, os.O_WRONLY, 0)
	if err != nil {
		return err
	}
	w := &devWriter{f: out, hashes: map[int64][32]byte{}, lens: map[int64]int{}}
	pr := &progressReader{r: f, total: st.Size(), cb: progress}
	total, _, err := WriteSparse(pr, w, 4<<20)
	if err == nil && total > size {
		err = fmt.Errorf("super image is %d bytes, partition is %d", total, size)
	}
	if err == nil {
		err = out.Sync()
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	in, err := os.Open(dev)
	if err != nil {
		return err
	}
	defer in.Close()
	buf := make([]byte, 4<<20)
	i := 0
	for off, l := range w.lens {
		if _, err := in.ReadAt(buf[:l], off); err != nil {
			return err
		}
		if sha256.Sum256(buf[:l]) != w.hashes[off] {
			return fmt.Errorf("read-back verification failed at offset %d", off)
		}
		i++
		progress(0.9 + 0.1*float64(i)/float64(len(w.lens)))
	}
	return nil
}
