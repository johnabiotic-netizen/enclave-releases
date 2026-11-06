#!/opt/enclave/venv/bin/python
"""Draws one pixel through WSL's D3D12 driver and prints what drew it, as JSON.

The agent runs this in a one-off container with the profile's GPU settings
(GALLIUM_DRIVER=d3d12, MESA_D3D12_DEFAULT_ADAPTER_NAME=<adapter>, /dev/dxg) before it
gives a profile that adapter: an adapter WSL lists but can't draw with (a driver without
WSL support) would leave the browser's window black. Prints
{"ok": true, "renderer": "D3D12 (<adapter>)", "pixel": [r, g, b, a]} or {"ok": false, ...}. Mesa
quietly draws on another adapter when the one asked for isn't there, so "ok" also needs the
renderer to name the adapter asked for.
No display is needed: EGL's surfaceless platform and an offscreen framebuffer.
"""

import ctypes
import json
import os
import sys

EGL_PLATFORM_SURFACELESS_MESA = 0x31DD
EGL_NONE = 0x3038
EGL_OPENGL_API = 0x30A2
EGL_RENDERABLE_TYPE = 0x3040
EGL_OPENGL_BIT = 0x0008
EGL_SURFACE_TYPE = 0x3033
GL_RENDERER = 0x1F01
GL_FRAMEBUFFER = 0x8D40
GL_RENDERBUFFER = 0x8D41
GL_RGBA8 = 0x8058
GL_COLOR_ATTACHMENT0 = 0x8CE0
GL_FRAMEBUFFER_COMPLETE = 0x8CD5
GL_COLOR_BUFFER_BIT = 0x4000
GL_RGBA = 0x1908
GL_UNSIGNED_BYTE = 0x1401


def fail(message: str) -> None:
    print(json.dumps({"ok": False, "error": message}))
    sys.exit(0)


def main() -> None:
    try:
        egl = ctypes.CDLL("libEGL.so.1")
    except OSError as e:
        fail(f"graphics library missing: {e}")

    egl.eglGetProcAddress.restype = ctypes.c_void_p
    egl.eglGetProcAddress.argtypes = [ctypes.c_char_p]
    get_platform_display = ctypes.CFUNCTYPE(
        ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p
    )(egl.eglGetProcAddress(b"eglGetPlatformDisplayEXT"))
    display = get_platform_display(EGL_PLATFORM_SURFACELESS_MESA, None, None)
    if not display:
        fail("no EGL display")
    egl.eglInitialize.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
    if not egl.eglInitialize(display, None, None):
        fail("EGL didn't initialize")
    egl.eglBindAPI(EGL_OPENGL_API)

    attrs = (ctypes.c_int * 5)(EGL_RENDERABLE_TYPE, EGL_OPENGL_BIT, EGL_SURFACE_TYPE, 0, EGL_NONE)
    config = ctypes.c_void_p()
    count = ctypes.c_int()
    egl.eglChooseConfig.argtypes = [
        ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p), ctypes.c_int, ctypes.POINTER(ctypes.c_int)
    ]
    if not egl.eglChooseConfig(display, attrs, ctypes.byref(config), 1, ctypes.byref(count)) or count.value < 1:
        fail("no EGL config")
    ctx_attrs = (ctypes.c_int * 1)(EGL_NONE)
    egl.eglCreateContext.restype = ctypes.c_void_p
    egl.eglCreateContext.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
    context = egl.eglCreateContext(display, config, None, ctx_attrs)
    if not context:
        fail("no GL context")
    egl.eglMakeCurrent.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
    if not egl.eglMakeCurrent(display, None, None, context):
        fail("GL context not current")

    def gl(name: str, restype, *argtypes):
        address = egl.eglGetProcAddress(name.encode())
        if not address:
            fail(f"{name} missing")
        return ctypes.CFUNCTYPE(restype, *argtypes)(address)

    u, i, f, p = ctypes.c_uint, ctypes.c_int, ctypes.c_float, ctypes.c_void_p
    renderer = (gl("glGetString", ctypes.c_char_p, u)(GL_RENDERER) or b"").decode(errors="replace")

    # An offscreen 1x1 picture, cleared to a known colour, read back.
    fbo, rbo = u(), u()
    gl("glGenFramebuffers", None, i, p)(1, ctypes.byref(fbo))
    gl("glBindFramebuffer", None, u, u)(GL_FRAMEBUFFER, fbo)
    gl("glGenRenderbuffers", None, i, p)(1, ctypes.byref(rbo))
    gl("glBindRenderbuffer", None, u, u)(GL_RENDERBUFFER, rbo)
    gl("glRenderbufferStorage", None, u, u, i, i)(GL_RENDERBUFFER, GL_RGBA8, 1, 1)
    gl("glFramebufferRenderbuffer", None, u, u, u, u)(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, rbo)
    if gl("glCheckFramebufferStatus", u, u)(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE:
        fail(f"framebuffer incomplete on {renderer}")
    gl("glClearColor", None, f, f, f, f)(0.2, 0.6, 0.8, 1.0)
    gl("glClear", None, u)(GL_COLOR_BUFFER_BIT)
    pixel = (ctypes.c_ubyte * 4)()
    gl("glReadPixels", None, i, i, i, i, u, u, p)(0, 0, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, pixel)
    got = list(pixel)
    drew = abs(got[0] - 51) <= 2 and abs(got[1] - 153) <= 2 and abs(got[2] - 204) <= 2
    # Mesa falls back to another adapter when the requested one isn't there: it must be this one.
    wanted = os.environ.get("MESA_D3D12_DEFAULT_ADAPTER_NAME", "")
    right_card = renderer == f"D3D12 ({wanted})" if wanted else renderer.startswith("D3D12")
    print(json.dumps({"ok": drew and right_card, "renderer": renderer, "pixel": got, "wanted": wanted}))


main()
