#!/opt/enclave/venv/bin/python
"""Keep the phone camera's latest frame for the browser (Stage 4).

neko writes the phone's camera, decoded to I420 at NEKO_CAPTURE_WEBCAM_WIDTH x
NEKO_CAPTURE_WEBCAM_HEIGHT, into the named pipe FIFO (Enclave's neko patch:
webcam device "fifo:<path>"). This copies each whole frame into SHM, which the
browser's camera reads (enclave-camoufox zz-enclave-phone-media.patch):

    32-byte header: b"ENCLCAM1", u32 width, u32 height, u32 sequence,
                    u32 reserved, u64 write time (microseconds since 1970)
    then the frame, tightly packed I420.

The sequence is odd while a frame is being written, so the reader never uses a
half-written frame. When the phone stops sharing, nothing new is written and the
browser shows black once the last frame is 2 seconds old.

While the phone is still sharing, a short gap in its frames (a network hiccup)
keeps the last frame on screen, as a real webcam would, instead of going black:
the last frame is published again every half second, for up to HOLD seconds.
"""

import mmap
import os
import select
import stat
import struct
import time

FIFO = "/tmp/enclave-camera.fifo"
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
        # Blocks until neko opens the pipe, which it does when the phone starts sharing.
        with open(FIFO, "rb", buffering=0) as pipe:
            poller = select.poll()
            poller.register(pipe, select.POLLIN)
            last = 0.0  # when the last whole frame arrived; 0 before the first
            while True:
                got = 0
                while got < frame_size:
                    if not poller.poll(500):
                        # No data for half a second: hold the last frame, if recent.
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
