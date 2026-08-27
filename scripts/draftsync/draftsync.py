#!/usr/bin/env python3
"""
draftsync — drop this in any folder, run it, and every audio file in that
folder is pushed into the music player under a "Recently uploaded" folder to
sort by hand later. Works unchanged from either Mac.

CR-1. It does exactly what the site's own batch folder-upload does, just from
the command line: PUT each file into the `inbox` storage bucket (band password
in the object path, same as the browser), POST `import-inbox` to register it as
a song + first mix, then file every new song into one music folder via
`create_music_folder` / `set_song_folder`.

Add-only by design: a file removed locally is never removed from the site.
Re-running is safe: files already up (matched by content hash) are skipped.

Usage:
    python3 draftsync.py            # upload the folder this script sits in
    python3 draftsync.py /some/dir  # upload that folder instead
    ./upload.command               # same as the first, double-clickable in Finder

Band + password: set up ONCE PER COMPUTER at ~/.snalbum-draftsync/config
(chmod 600), then this script needs no per-folder setup. A `.snalbum-draftsync`
file sitting next to the script (or in the target folder) overrides it.

    BAND=dando
    BAND_PASS=your-band-password
    # optional:
    # FOLDER_NAME=Recently uploaded
    # MAX_MB=50
    # STABLE_SECONDS=10

Per-folder upload state is kept in `.snalbum-draftsync-state.json` inside the
folder, so moving the folder carries its history with it. Delete that file to
force a fresh scan (already-uploaded files still won't double up).
"""

import hashlib
import json
import logging
import mimetypes
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HOME = Path.home()
HOME_CFG_DIR = HOME / ".snalbum-draftsync"
HOME_CFG = HOME_CFG_DIR / "config"
HOME_LOG = HOME_CFG_DIR / "draftsync.log"
LOCAL_CFG_NAME = ".snalbum-draftsync"
STATE_NAME = ".snalbum-draftsync-state.json"
LOCK_NAME = ".snalbum-draftsync-lock"

# Public, ships in core.js — safe to hardcode as defaults.
SUPABASE_URL = "https://twgukeyoayfqldnojrkg.supabase.co"
SUPABASE_KEY = "sb_publishable_zIiAxxA5Zk1yRNzignANXA_rEp3vKdG"

AUDIO_RE = re.compile(r"\.(mp3|m4a|aac|ogg|opus|wav|aif|aiff|flac)$", re.I)
# Storage's key whitelist is narrower than a real title; this is the exact
# strip music.html applies to a song/version name before upload.
SANITISE_RE = re.compile(r"[^A-Za-z0-9_.\- ]+")

DEFAULTS = {
    "FOLDER_NAME": "Recently uploaded",
    "MAX_MB": "50",          # Supabase free-tier per-file ceiling, not adjustable
    "STABLE_SECONDS": "10",  # ignore a file whose mtime is younger than this (still bouncing)
    "SUPABASE_URL": SUPABASE_URL,
    "SUPABASE_KEY": SUPABASE_KEY,
}

SCRIPT_DIR = Path(__file__).resolve().parent


def target_dir() -> Path:
    if len(sys.argv) > 1:
        d = Path(os.path.expanduser(sys.argv[1])).resolve()
    else:
        d = SCRIPT_DIR
    if not d.is_dir():
        print(f"not a folder: {d}", file=sys.stderr)
        sys.exit(2)
    return d


def setup_logging(target: Path) -> None:
    handlers = [logging.StreamHandler(sys.stdout)]
    try:
        HOME_CFG_DIR.mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(HOME_LOG))
    except OSError:
        pass
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s",
                        handlers=handlers)


def load_config(target: Path) -> dict:
    cfg = dict(DEFAULTS)
    local = None
    for cand in (SCRIPT_DIR / LOCAL_CFG_NAME, target / LOCAL_CFG_NAME):
        if cand.is_file():
            local = cand
            break
    src = local or (HOME_CFG if HOME_CFG.is_file() else None)
    if src is None:
        logging.error("no band config found. Create %s (chmod 600) with BAND= and "
                      "BAND_PASS=, or drop a %s file next to this script.",
                      HOME_CFG, LOCAL_CFG_NAME)
        sys.exit(2)
    for raw in src.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        cfg[key.strip()] = val.strip()
    missing = [k for k in ("BAND", "BAND_PASS") if not cfg.get(k)]
    if missing:
        logging.error("%s is missing: %s", src, ", ".join(missing))
        sys.exit(2)
    cfg["_config_src"] = str(src)
    return cfg


def load_state(target: Path) -> dict:
    try:
        return json.loads((target / STATE_NAME).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {"files": {}, "folder_id": None}


def save_state(target: Path, state: dict) -> None:
    path = target / STATE_NAME
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True))
    tmp.replace(path)


def acquire_lock(target: Path):
    """Single instance per folder. A second run just exits."""
    import fcntl
    fh = open(target / LOCK_NAME, "w")
    try:
        fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        logging.info("another run is working this folder — exiting")
        sys.exit(0)
    return fh  # keep alive for process lifetime


def sha1(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sanitise(name: str) -> str:
    return SANITISE_RE.sub("", name).strip()


def _request(url: str, *, data: bytes, headers: dict, method: str = "POST"):
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace")
    except urllib.error.URLError as exc:
        return 0, str(exc)


def put_inbox(cfg: dict, song: str, filename: str, blob: bytes) -> None:
    seg = "/".join(urllib.parse.quote(s, safe="")
                   for s in (cfg["BAND"], cfg["BAND_PASS"], song, filename))
    url = f'{cfg["SUPABASE_URL"]}/storage/v1/object/inbox/{seg}'
    ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    status, body = _request(url, data=blob, method="POST", headers={
        "apikey": cfg["SUPABASE_KEY"],
        "Authorization": "Bearer " + cfg["SUPABASE_KEY"],
        "Content-Type": ctype,
        "x-upsert": "true",
    })
    if status not in (200, 201):
        raise RuntimeError(f"inbox PUT {filename} -> {status}: {body[:300]}")


def call_json(cfg: dict, path: str, payload: dict):
    url = f'{cfg["SUPABASE_URL"]}{path}'
    status, body = _request(url, data=json.dumps(payload).encode(), method="POST",
                            headers={
                                "apikey": cfg["SUPABASE_KEY"],
                                "Authorization": "Bearer " + cfg["SUPABASE_KEY"],
                                "Content-Type": "application/json",
                            })
    if status not in (200, 201, 204):
        raise RuntimeError(f"{path} -> {status}: {body[:300]}")
    try:
        return json.loads(body) if body else None
    except json.JSONDecodeError:
        return body


def import_inbox(cfg: dict, song: str) -> int:
    res = call_json(cfg, "/functions/v1/import-inbox",
                    {"band": cfg["BAND"], "pass": cfg["BAND_PASS"], "song": song})
    if isinstance(res, dict) and res.get("error"):
        raise RuntimeError(f"import-inbox {song}: {res['error']}")
    return res.get("imported", 0) if isinstance(res, dict) else 0


def ensure_folder(cfg: dict) -> str:
    return call_json(cfg, "/rest/v1/rpc/create_music_folder",
                     {"b": cfg["BAND"], "p": cfg["BAND_PASS"], "fname": cfg["FOLDER_NAME"]})


def file_into_folder(cfg: dict, song: str, fid: str) -> None:
    call_json(cfg, "/rest/v1/rpc/set_song_folder",
              {"b": cfg["BAND"], "p": cfg["BAND_PASS"], "f": song, "fid": fid})


def main() -> None:
    target = target_dir()
    setup_logging(target)
    cfg = load_config(target)
    _lock = acquire_lock(target)  # noqa: F841 — held for process lifetime
    state = load_state(target)
    files_state = state.setdefault("files", {})

    max_bytes = int(cfg["MAX_MB"]) * 1024 * 1024
    stable = float(cfg["STABLE_SECONDS"])
    now = time.time()
    logging.info("scanning %s  (band %s, via %s)", target, cfg["BAND"], cfg["_config_src"])

    candidates = [p for p in sorted(target.rglob("*"))
                  if p.is_file() and AUDIO_RE.search(p.name)]
    new_songs, touched_songs = [], set()

    for path in candidates:
        rel = str(path.relative_to(target))
        try:
            st = path.stat()
        except FileNotFoundError:
            continue

        if now - st.st_mtime < stable:
            logging.info("skip (still being written): %s", rel)
            continue

        prev = files_state.get(rel)
        if prev and prev.get("size") == st.st_size and prev.get("mtime") == int(st.st_mtime):
            continue  # unchanged, cheap path, no hashing

        digest = sha1(path)
        if prev and prev.get("sha1") == digest:
            prev.update(size=st.st_size, mtime=int(st.st_mtime))
            continue

        if st.st_size > max_bytes:
            if not (prev and prev.get("skipped")):
                logging.warning("SKIPPED (%d MB, over the %s MB ceiling): %s",
                                st.st_size // (1024 * 1024), cfg["MAX_MB"], rel)
            files_state[rel] = {"size": st.st_size, "mtime": int(st.st_mtime),
                                "sha1": digest, "skipped": True}
            continue

        song = sanitise(path.stem) or "untitled"
        upname = sanitise(path.stem) + path.suffix.lower()
        try:
            logging.info("uploading: %s  ->  song “%s”", rel, song)
            put_inbox(cfg, song, upname, path.read_bytes())
        except Exception as exc:  # leave out of state so it retries next run
            logging.error("%s", exc)
            continue

        files_state[rel] = {"size": st.st_size, "mtime": int(st.st_mtime),
                            "sha1": digest, "song": song,
                            "uploaded_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        touched_songs.add(song)
        if not prev:
            new_songs.append(song)

    if not touched_songs:
        save_state(target, state)
        logging.info("nothing new")
        return

    imported_total, registered = 0, set()
    for song in sorted(touched_songs):
        try:
            imported_total += import_inbox(cfg, song)
            registered.add(song)
        except Exception as exc:
            logging.error("%s", exc)

    # File freshly-created songs into "Recently uploaded". Only ones new this
    # run — a song already dragged elsewhere is left where he put it.
    to_file = [s for s in new_songs if s in registered]
    if to_file:
        try:
            fid = ensure_folder(cfg)
            state["folder_id"] = fid
            for song in to_file:
                file_into_folder(cfg, song, fid)
            logging.info("filed %d new song(s) into “%s”",
                         len(to_file), cfg["FOLDER_NAME"])
        except Exception as exc:
            logging.error("could not file into %s: %s", cfg["FOLDER_NAME"], exc)

    save_state(target, state)
    logging.info("done — %d file(s) up, %d mix(es) registered",
                 len(touched_songs), imported_total)


if __name__ == "__main__":
    main()
