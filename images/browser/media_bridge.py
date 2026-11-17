#!/opt/session/venv/bin/python

import mmap
import os
import select
import stat
import struct
import time

FIFO = "/tmp/session-media.fifo"
SHM = "/dev/shm/enclave-camera"
HEADER = 32
HOLD = 10.0  # seconds a sharing phone's last frame stays on screen without new ones

def main() -> None:
    width = int(os.environ.get("NEKO_CAPTURE_WEBCAM_WIDTH", "1280"))
    height = int(os.environ.get("NEKO_CAPTURE_WEBCAM_HEIGHT", "720"))
    frame_size = width * height + 2 * ((width + 1) // 2) * ((height + 1) // 2)

    if os.path.exists(FIFO) and not stat.S_ISFIFO(os.stat(FIFO).st_mode):
        os.remove(FIFO)
    if not os.path.exists(FIFO):
        os.mkfifo(FIFO, 0o600)

    fd = os.open(SHM, os.O_RDWR | os.O_CREAT, 0o600)
    os.ftruncate(fd, HEADER + frame_size)
    shm = mmap.mmap(fd, HEADER + frame_size)
    os.close(fd)
    shm[0:8] = b"ENCLCAM1"
    struct.pack_into("<IIIIQ", shm, 8, width, height, 0, 0, 0)

    sequence = 0

    def publish(new_frame: bytearray | None) -> None:
        nonlocal sequence
        sequence += 1
        struct.pack_into("<I", shm, 16, sequence)
        if new_frame is not None:
            shm[HEADER : HEADER + frame_size] = new_frame
        struct.pack_into("<Q", shm, 24, time.time_ns() // 1000)
        sequence += 1
        struct.pack_into("<I", shm, 16, sequence)

    frame = bytearray(frame_size)
    view = memoryview(frame)
    while True:
        with open(FIFO, "rb", buffering=0) as pipe:
            poller = select.poll()
            poller.register(pipe, select.POLLIN)
            last = 0.0  # when the last whole frame arrived; 0 before the first
            while True:
                got = 0
                while got < frame_size:
                    if not poller.poll(500):
                        if last and time.monotonic() - last < HOLD:
                            publish(None)
                        continue
                    n = pipe.readinto(view[got:])
                    if not n:
                        break
                    got += n
                if got < frame_size:
                    break  # neko closed the pipe: the phone stopped sharing
                publish(frame)
                last = time.monotonic()

if __name__ == "__main__":
    main()
