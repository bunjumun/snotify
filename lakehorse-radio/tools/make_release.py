#!/usr/bin/env python3
"""Collect a built firmware into firmware/lakehorse-radio/ with a manifest.

The point of this script is one number. The Gemini spec hardcoded the LittleFS
offset as 0x290000, which was wrong, and the failure mode of a wrong filesystem
offset is silent: the board boots, serves nothing, and looks like a bad build.

So the offset is never typed twice. It is parsed out of partitions.csv here and
written into manifest.json, and the browser flasher reads the manifest rather
than carrying its own copy. If the partition table changes, the flasher follows
automatically and cannot drift.
"""
import csv
import hashlib
import json
import shutil
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
BUILD = PROJECT / ".pio" / "build" / "radio"
OUT = PROJECT.parent / "firmware" / "lakehorse-radio"

# Fixed by the ESP32 boot ROM, not by us. On a classic ESP32 the second-stage
# bootloader lives at 0x1000; the S3 and C3 use 0x0, which is the single most
# common way to brick a flash by copying someone else's offsets.
BOOTLOADER_OFFSET = 0x1000
PARTITION_TABLE_OFFSET = 0x8000
BOOT_APP0_OFFSET = 0xE000
APP_OFFSET = 0x10000


def parse_int(text):
    text = text.strip()
    return int(text, 16) if text.lower().startswith("0x") else int(text)


def filesystem_offset(csv_path):
    """Read the data/spiffs partition offset straight out of the table."""
    with csv_path.open() as fh:
        for row in csv.reader(fh):
            if not row or row[0].strip().startswith("#"):
                continue
            if len(row) < 5:
                continue
            name, ptype, subtype, offset, size = (c.strip() for c in row[:5])
            if ptype == "data" and subtype in ("spiffs", "littlefs"):
                return parse_int(offset), parse_int(size)
    raise SystemExit("no data/spiffs partition found in partitions.csv")


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    if not BUILD.exists():
        raise SystemExit(f"no build at {BUILD}; run `pio run -e radio` first")

    fs_offset, fs_size = filesystem_offset(PROJECT / "partitions.csv")

    sources = {
        "bootloader.bin": (BUILD / "bootloader.bin", BOOTLOADER_OFFSET),
        "partitions.bin": (BUILD / "partitions.bin", PARTITION_TABLE_OFFSET),
        "boot_app0.bin": (None, BOOT_APP0_OFFSET),  # located below, it ships with the core
        "firmware.bin": (BUILD / "firmware.bin", APP_OFFSET),
        "littlefs.bin": (BUILD / "littlefs.bin", fs_offset),
    }

    # boot_app0.bin comes from the Arduino core package rather than the build
    # directory. Without it the bootloader reads an unwritten otadata partition
    # and can sit in a boot loop, which looks like a bad firmware image.
    core = Path.home() / ".platformio" / "packages" / "framework-arduinoespressif32"
    candidates = list(core.glob("tools/partitions/boot_app0.bin"))
    if not candidates:
        raise SystemExit("could not find boot_app0.bin in the Arduino core package")
    sources["boot_app0.bin"] = (candidates[0], BOOT_APP0_OFFSET)

    OUT.mkdir(parents=True, exist_ok=True)

    parts = []
    for name, (src, offset) in sorted(sources.items(), key=lambda kv: kv[1][1]):
        if src is None or not src.exists():
            raise SystemExit(f"missing build artefact: {name} (expected at {src})")
        dest = OUT / name
        shutil.copy2(src, dest)
        parts.append({
            "path": name,
            "offset": offset,
            "offsetHex": hex(offset),
            "bytes": dest.stat().st_size,
            "sha256": sha256(dest),
        })

    # A filesystem image larger than its partition would be written straight
    # over whatever follows it. Catch that here rather than on the device.
    for p in parts:
        if p["path"] == "littlefs.bin" and p["bytes"] > fs_size:
            raise SystemExit(
                f"littlefs.bin is {p['bytes']} bytes but the partition is {fs_size}"
            )

    manifest = {
        "name": "Lakehorse Radio",
        "chip": "esp32",
        "flashSize": "4MB",
        "flashMode": "dio",
        "flashFreq": "40m",
        "filesystemOffset": hex(fs_offset),
        "filesystemSize": hex(fs_size),
        "parts": parts,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    print(f"wrote {OUT}")
    for p in parts:
        print(f"  {p['offsetHex']:>10}  {p['path']:<16} {p['bytes']:>9,} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
