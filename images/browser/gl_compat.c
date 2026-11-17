#define _GNU_SOURCE
#include <dlfcn.h>
#include <string.h>

typedef unsigned int GLenum;
typedef int GLint;
typedef void (*getintegerv_fn)(GLenum, GLint *);
typedef void *(*getprocaddress_fn)(const char *);
typedef void *(*dlsym_fn)(void *, const char *);

#define GL_STENCIL_VALUE_MASK 0x0B93
#define GL_STENCIL_WRITEMASK 0x0B98
#define GL_STENCIL_BACK_VALUE_MASK 0x8CA4
#define GL_STENCIL_BACK_WRITEMASK 0x8CA5
#define ANGLE_ALL_ONES (-1) /* 0xFFFFFFFF, read by Firefox as an unsigned int */

static getintegerv_fn real_getintegerv;
static getprocaddress_fn real_egl_getprocaddress;
static getprocaddress_fn real_glx_getprocaddress;

static dlsym_fn real_dlsym(void) {
  static dlsym_fn fn;
  if (!fn) fn = (dlsym_fn)dlvsym(RTLD_NEXT, "dlsym", "GLIBC_2.34");
  if (!fn) fn = (dlsym_fn)dlvsym(RTLD_NEXT, "dlsym", "GLIBC_2.2.5");
  return fn;
}

static void shim_getintegerv(GLenum pname, GLint *data) {
  real_getintegerv(pname, data);
  if (pname != GL_STENCIL_VALUE_MASK && pname != GL_STENCIL_WRITEMASK &&
      pname != GL_STENCIL_BACK_VALUE_MASK && pname != GL_STENCIL_BACK_WRITEMASK)
    return;
  if (*data == 0xFF) *data = ANGLE_ALL_ONES;
}

static void *wrap(const char *name, void *fn) {
  if (!fn || !name) return fn;
  if (strcmp(name, "glGetIntegerv") == 0) {
    real_getintegerv = (getintegerv_fn)fn;
    return (void *)shim_getintegerv;
  }
  return fn;
}

static void *shim_egl_getprocaddress(const char *name) {
  return wrap(name, real_egl_getprocaddress(name));
}

static void *shim_glx_getprocaddress(const char *name) {
  return wrap(name, real_glx_getprocaddress(name));
}

void *dlsym(void *handle, const char *name) {
  void *fn = real_dlsym()(handle, name);
  if (!fn) return fn;
  if (strcmp(name, "eglGetProcAddress") == 0) {
    real_egl_getprocaddress = (getprocaddress_fn)fn;
    return (void *)shim_egl_getprocaddress;
  }
  if (strcmp(name, "glXGetProcAddress") == 0 || strcmp(name, "glXGetProcAddressARB") == 0) {
    real_glx_getprocaddress = (getprocaddress_fn)fn;
    return (void *)shim_glx_getprocaddress;
  }
  return wrap(name, fn);
}
