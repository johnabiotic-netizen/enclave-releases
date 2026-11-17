# Test-only, runs inside a profile container as neko, with media_bridge stopped: stands in for
# media_bridge with slow writes. A mid-grey frame 50 times a second, each write holding the sequence
# odd for 4 ms (as a busy PC can), for 50 s. The browser must never show a black frame.
import mmap, os, struct, time

SHM = "/dev/shm/enclave-camera"
W, H = 1280, 720
size = W * H + 2 * (W // 2) * (H // 2)
fd = os.open(SHM, os.O_RDWR | os.O_CREAT, 0o600)
os.ftruncate(fd, 32 + size)
m = mmap.mmap(fd, 32 + size)
os.close(fd)
m[0:8] = b"ENCLCAM1"
struct.pack_into("<IIIIQ", m, 8, W, H, 0, 0, 0)
frame = bytes([150]) * (W * H) + bytes([128]) * (size - W * H)
seq, end = 0, time.time() + 50
while time.time() < end:
    seq += 1
    struct.pack_into("<I", m, 16, seq)
    m[32 : 32 + size] = frame
    time.sleep(0.004)
    struct.pack_into("<Q", m, 24, time.time_ns() // 1000)
    seq += 1
    struct.pack_into("<I", m, 16, seq)
    time.sleep(0.016)
