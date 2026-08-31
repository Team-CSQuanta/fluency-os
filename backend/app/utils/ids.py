import os
import time
import uuid


def uuid7() -> str:
    """Minimal RFC 9562 UUIDv7: 48-bit millisecond timestamp + random bits.

    Vendored instead of adding a dependency for one function (per the
    "keep footprint reasonable" constraint) — the spec requires UUIDv7 text
    IDs so records stay mergeable across devices in a future sync feature.
    """
    unix_ms = int(time.time() * 1000)
    ts_bytes = unix_ms.to_bytes(6, byteorder="big")
    rand_bytes = os.urandom(10)

    # byte 6: version (7) in top nibble, top 4 bits of rand in low nibble
    b6 = 0x70 | (rand_bytes[0] & 0x0F)
    # byte 8: variant (10) in top 2 bits
    b8 = 0x80 | (rand_bytes[2] & 0x3F)

    raw = bytes(
        [
            *ts_bytes,
            b6,
            rand_bytes[1],
            b8,
            rand_bytes[3],
            *rand_bytes[4:10],
        ]
    )
    return str(uuid.UUID(bytes=raw))
