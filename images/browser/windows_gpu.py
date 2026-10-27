"""What Windows Firefox reports for a graphics card (WEBGL_debug_renderer_info).

Profiles render on the PC's real GPU (through WSL's D3D12 driver), so they must claim
exactly that GPU, the way Firefox on Windows names it. Firefox does not report the
model: dom/canvas/SanitizeRenderer.cpp (ChooseDeviceReplacement) maps it to one of a
few representative cards, and ANGLE wraps that in "ANGLE (<vendor>, <card> Direct3D11
vs_5_0 ps_5_0), or similar". This is a port of that mapping for the GPUs Windows PCs
have (Intel, NVIDIA, AMD).

  windows_webgl_pair("Intel(R) HD Graphics 620")
  -> ("Google Inc. (Intel)", "ANGLE (Intel, Intel(R) HD Graphics 400 Direct3D11 vs_5_0 ps_5_0), or similar")
"""

import re
from typing import Optional, Tuple

RADEON_HD_3000 = "Radeon HD 3200 Graphics"
RADEON_HD_5850 = "Radeon HD 5850"
RADEON_R9_290 = "Radeon R9 200 Series"
GEFORCE_8800 = "GeForce 8800 GTX"
GEFORCE_480 = "GeForce GTX 480"
GEFORCE_980 = "GeForce GTX 980"
INTEL_HD = "Intel(R) HD Graphics"
INTEL_HD_400 = "Intel(R) HD Graphics 400"
INTEL_945GM = "Intel 945GM"
INTEL_ARC = "Intel(R) Arc(TM) A750 Graphics"


def _amd(name: str) -> Optional[str]:
    if any(s in name for s in ("REMBRANDT", "RENOIR", "Vega", "VII", "Fury")):
        return RADEON_R9_290
    m = re.search(r"Radeon.*?((R[579X]|HD) )?([0-9][0-9][0-9]+)", name)
    if m:
        model = int(m.group(3))
        if m.group(2) == "HD":
            return RADEON_HD_5850 if model >= 5000 else RADEON_HD_3000
        return RADEON_R9_290
    m = re.search(r"FirePro.*?([VDW])[0-9][0-9][0-9]+", name)
    if m:
        return RADEON_HD_3000 if m.group(1) == "V" else RADEON_R9_290
    if "ARUBA" in name:
        return RADEON_HD_5850
    if "AMD " in name or "FirePro" in name or "Radeon" in name:
        return RADEON_HD_3000
    return None


def _nvidia(name: str) -> Optional[str]:
    if not any(s in name for s in ("NVIDIA", "GeForce", "Quadro")):
        return None
    card = GEFORCE_8800
    m = re.search(r"GeForce.*?([0-9][0-9][0-9]+)", name)
    q = re.search(r"Quadro.*?([KMPVT]?)[0-9][0-9][0-9]+", name)
    t = re.search(r"TITAN( [BZXVR])?", name)
    if m:
        model = int(m.group(1))
        if model >= 8000:
            card = GEFORCE_8800
        elif model >= 900:
            card = GEFORCE_980
        elif model >= 400:
            card = GEFORCE_480
    elif q:
        if "RTX" in name:
            card = GEFORCE_980
        elif q.group(1) in ("M", "P", "V", "T"):
            card = GEFORCE_980
        elif q.group(1):
            card = GEFORCE_480
    elif t:
        card = GEFORCE_480 if (t.group(1) or " ")[-1] in (" ", "B", "Z") else GEFORCE_980
    # ANGLE reports "NVIDIA GeForce ..." (the adapter name starts with NVIDIA).
    return f"NVIDIA {card}" if name.startswith("NVIDIA") else card


def _intel(name: str) -> Optional[str]:
    if "Intel" not in name:
        return None
    if "Intel(R) Arc(TM)" in name:
        return INTEL_ARC
    m = re.search(r"Intel.*Graphics( P?([0-9][0-9][0-9]+))?", name)
    if m:
        if not m.group(1):
            return INTEL_HD
        model = int(m.group(2))
        if model >= 5000:
            return INTEL_HD_400
        if model >= 1000:
            return INTEL_HD
        return INTEL_HD_400
    return INTEL_945GM


def windows_webgl_pair(adapter: str) -> Tuple[str, str]:
    """(UNMASKED_VENDOR_WEBGL, UNMASKED_RENDERER_WEBGL) of Windows Firefox on `adapter`,
    the name Windows gives the card (e.g. from Win32_VideoController)."""
    for vendor, mapper in (("AMD", _amd), ("NVIDIA", _nvidia), ("Intel", _intel)):
        card = mapper(adapter)
        if card:
            return f"Google Inc. ({vendor})", f"ANGLE ({vendor}, {card} Direct3D11 vs_5_0 ps_5_0), or similar"
    raise ValueError(f"unsupported graphics card: {adapter!r}")
