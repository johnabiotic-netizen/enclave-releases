# Test-only, runs inside a profile container: once a second, the phone camera frames reaching
# the browser (new, held repeats, dark) and the age of the newest one, plus neko's connection
# events. A gap with no lines means no new frames and no events. Argument: seconds (default 900).
import mmap, re, struct, sys, time, zlib

f = open("/dev/shm/enclave-camera", "rb")
m = mmap.mmap(f.fileno(), 0, prot=mmap.PROT_READ)
w, h = struct.unpack_from("<II", m, 8)


def luma():
    return sum(m[32 + (gy * h // 9) * w + gx * w // 17] for gy in range(1, 9) for gx in range(1, 17)) / 128


log = open("/var/log/neko/neko.log", "rb")
log.seek(0, 2)
EV = re.compile(
    rb"connection state changed|session created|session disconnected|remote track (stopped|data finished)"
    rb"|received new remote track|creating pipeline.*webcam|destroying pipeline.*webcam"
)
last_seq, last_sig = -1, None
end = time.time() + float(sys.argv[1] if len(sys.argv) > 1 else 900)
nxt = time.time() + 1
new = held = dark = 0
while time.time() < end:
    seq = struct.unpack_from("<I", m, 16)[0]
    if seq != last_seq and seq % 2 == 0:
        last_seq = seq
        sig = zlib.crc32(m[32 + w * (h // 2) : 32 + w * (h // 2) + w])
        if sig != last_sig:
            new += 1
            last_sig = sig
            if luma() < 20:
                dark += 1
        else:
            held += 1
    if time.time() >= nxt:
        nxt += 1
        age = time.time() - struct.unpack_from("<Q", m, 24)[0] / 1e6
        evs = [re.sub(rb"\x1b\[[0-9;]*m", b"", l).decode(errors="replace")[:110] for l in log.readlines() if EV.search(l)]
        if new or held or evs:
            print(f"{time.strftime('%T')} UTC  camera: new {new:2d} held {held} dark {dark}  newest {min(age, 99):4.1f} s old", flush=True)
            for e in evs:
                print("    neko:", e, flush=True)
        new = held = dark = 0
    time.sleep(0.004)
