#define _GNU_SOURCE
#include <arpa/inet.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <pthread.h>
#include <sched.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/sysinfo.h>
#include <sys/utsname.h>
#include <unistd.h>

typedef void *(*dlsym_fn)(void *, const char *);

static void *real_dlsym_lookup(void *handle, const char *symbol) {
  static dlsym_fn fn = NULL;
  if (!fn) {
    fn = (dlsym_fn)dlvsym(RTLD_NEXT, "dlsym", "GLIBC_2.2.5");
    if (!fn) fn = (dlsym_fn)dlvsym(RTLD_NEXT, "dlsym", "GLIBC_2.34");
    if (!fn) fn = (dlsym_fn)dlvsym(RTLD_DEFAULT, "dlsym", "GLIBC_2.2.5");
  }
  return fn ? fn(handle, symbol) : NULL;
}

static int cached_cores = 8;
static int cached_ram_gb = 8;
static int cached_proxy_port = 0;
static int cached_block_udp = 1;
static char cached_cpu_online[32] = "0-7\n";

static int read_int_file(const char *path, int fallback) {
  typedef int (*open_fn)(const char *, int, ...);
  open_fn real_open = (open_fn)real_dlsym_lookup(RTLD_NEXT, "open");
  if (!real_open) return fallback;
  int fd = real_open(path, O_RDONLY);
  if (fd < 0) return fallback;
  char buf[64];
  ssize_t n = read(fd, buf, sizeof(buf) - 1);
  close(fd);
  if (n <= 0) return fallback;
  buf[n] = '\0';
  int v = atoi(buf);
  return v > 0 ? v : fallback;
}

__attribute__((constructor)) static void persona_engine_init(void) {
  const char *c_env = getenv("PERSONA_HOST_CORES");
  int c = c_env ? atoi(c_env) : read_int_file("/tmp/persona_cores", 8);
  if (c < 2 || c > 64) c = 8;
  cached_cores = c;
  snprintf(cached_cpu_online, sizeof(cached_cpu_online), "0-%d\n", c - 1);

  const char *r_env = getenv("PERSONA_DEVICE_MEMORY_GB");
  int r = r_env ? atoi(r_env) : read_int_file("/tmp/persona_ram_gb", 8);
  if (r < 2 || r > 64) r = 8;
  cached_ram_gb = r;

  const char *p_env = getenv("PERSONA_LOCAL_PROXY_PORT");
  cached_proxy_port = p_env ? atoi(p_env) : read_int_file("/tmp/persona_proxy_port", 0);

  const char *u_env = getenv("PERSONA_BLOCK_NON_LOCAL_UDP");
  if (u_env) {
    cached_block_udp = (strcmp(u_env, "1") == 0) ? 1 : 0;
  } else {
    cached_block_udp = read_int_file("/tmp/persona_block_udp", 1) ? 1 : 0;
  }
}

static int get_fake_cores(void) {
  return (cached_cores >= 2 && cached_cores <= 64) ? cached_cores : 8;
}

static unsigned long long get_fake_ram_bytes(void) {
  int gb = (cached_ram_gb >= 2 && cached_ram_gb <= 64) ? cached_ram_gb : 8;
  return (unsigned long long)gb * 1024ULL * 1024ULL * 1024ULL;
}

static int get_allowed_proxy_port(void) {
  if (cached_proxy_port > 0) return cached_proxy_port;
  const char *env = getenv("PERSONA_LOCAL_PROXY_PORT");
  return env ? atoi(env) : 0;
}

static int should_block_udp(void) {
  return cached_block_udp;
}

static int is_cpu_online_path(const char *path) {
  if (!path) return 0;
  return (strcmp(path, "/sys/devices/system/cpu/online") == 0 ||
          strcmp(path, "/sys/devices/system/cpu/present") == 0 ||
          strcmp(path, "/sys/devices/system/cpu/possible") == 0);
}

static const char *remap_proc_path(const char *path) {
  if (!path) return path;
  if (strcmp(path, "/proc/meminfo") == 0 && access("/tmp/persona_meminfo", R_OK) == 0) {
    return "/tmp/persona_meminfo";
  }
  if (strcmp(path, "/proc/cpuinfo") == 0 && access("/tmp/persona_cpuinfo", R_OK) == 0) {
    return "/tmp/persona_cpuinfo";
  }
  if (is_cpu_online_path(path) && access("/tmp/persona_cpu_online", R_OK) == 0) {
    return "/tmp/persona_cpu_online";
  }
  return path;
}

static int make_cpu_online_fd(void) {
  int pfd[2];
  if (pipe(pfd) != 0) return -1;
  size_t len = strlen(cached_cpu_online);
  ssize_t w = write(pfd[1], cached_cpu_online, len);
  (void)w;
  close(pfd[1]);
  return pfd[0];
}

long sysconf(int name) {
  typedef long (*sysconf_fn)(int);
  static sysconf_fn real_sysconf = NULL;
  if (!real_sysconf) real_sysconf = (sysconf_fn)real_dlsym_lookup(RTLD_NEXT, "sysconf");

  if (name == _SC_NPROCESSORS_ONLN || name == _SC_NPROCESSORS_CONF) {
    return get_fake_cores();
  }
  if (name == _SC_PHYS_PAGES) {
    long page_size = real_sysconf(_SC_PAGESIZE);
    if (page_size <= 0) page_size = 4096;
    return (long)(get_fake_ram_bytes() / (unsigned long long)page_size);
  }
  if (name == _SC_AVPHYS_PAGES) {
    long page_size = real_sysconf(_SC_PAGESIZE);
    if (page_size <= 0) page_size = 4096;
    return (long)((get_fake_ram_bytes() * 7ULL / 10ULL) / (unsigned long long)page_size);
  }
  return real_sysconf(name);
}

int get_nprocs(void) {
  return get_fake_cores();
}

int get_nprocs_conf(void) {
  return get_fake_cores();
}

int __sched_cpucount(size_t setsize, const cpu_set_t *setp) {
  (void)setsize;
  (void)setp;
  return get_fake_cores();
}

static void fill_fake_cpuset(size_t cpusetsize, cpu_set_t *mask) {
  if (!mask || cpusetsize == 0) return;
  memset(mask, 0, cpusetsize);
  int cores = get_fake_cores();
  unsigned char *bytes = (unsigned char *)mask;
  for (int i = 0; i < cores && (size_t)(i / 8) < cpusetsize; i++) {
    bytes[i / 8] |= (unsigned char)(1U << (i % 8));
  }
}

int sched_getaffinity(pid_t pid, size_t cpusetsize, cpu_set_t *mask) {
  typedef int (*affinity_fn)(pid_t, size_t, cpu_set_t *);
  static affinity_fn real_affinity = NULL;
  if (!real_affinity) real_affinity = (affinity_fn)real_dlsym_lookup(RTLD_NEXT, "sched_getaffinity");

  int rc = real_affinity(pid, cpusetsize, mask);
  if (rc == 0 && mask && cpusetsize > 0) {
    fill_fake_cpuset(cpusetsize, mask);
  }
  return rc;
}

int pthread_getaffinity_np(pthread_t thread, size_t cpusetsize, cpu_set_t *cpuset) {
  typedef int (*paffinity_fn)(pthread_t, size_t, cpu_set_t *);
  static paffinity_fn real_paffinity = NULL;
  if (!real_paffinity) {
    real_paffinity = (paffinity_fn)real_dlsym_lookup(RTLD_NEXT, "pthread_getaffinity_np");
  }
  int rc = real_paffinity ? real_paffinity(thread, cpusetsize, cpuset) : 0;
  if (rc == 0 && cpuset && cpusetsize > 0) {
    fill_fake_cpuset(cpusetsize, cpuset);
  }
  return rc;
}

int sysinfo(struct sysinfo *info) {
  typedef int (*sysinfo_fn)(struct sysinfo *);
  static sysinfo_fn real_sysinfo = NULL;
  if (!real_sysinfo) real_sysinfo = (sysinfo_fn)real_dlsym_lookup(RTLD_NEXT, "sysinfo");

  int rc = real_sysinfo(info);
  if (rc == 0 && info) {
    unsigned long long bytes = get_fake_ram_bytes();
    unsigned long unit = info->mem_unit ? info->mem_unit : 1;
    info->totalram = (unsigned long)(bytes / unit);
    info->freeram = (unsigned long)((bytes * 6ULL / 10ULL) / unit);
  }
  return rc;
}

int uname(struct utsname *buf) {
  typedef int (*uname_fn)(struct utsname *);
  static uname_fn real_uname = NULL;
  if (!real_uname) real_uname = (uname_fn)real_dlsym_lookup(RTLD_NEXT, "uname");

  int rc = real_uname(buf);
  if (rc == 0 && buf) {
    snprintf(buf->nodename, sizeof(buf->nodename), "desktop-pc");
    snprintf(buf->release, sizeof(buf->release), "6.8.0-45-generic");
  }
  return rc;
}

FILE *fopen(const char *pathname, const char *mode) {
  typedef FILE *(*fopen_fn)(const char *, const char *);
  static fopen_fn real_fopen = NULL;
  if (!real_fopen) real_fopen = (fopen_fn)real_dlsym_lookup(RTLD_NEXT, "fopen");
  if (is_cpu_online_path(pathname) && mode && mode[0] == 'r') {
    FILE *mem = fmemopen(cached_cpu_online, strlen(cached_cpu_online), "r");
    if (mem) return mem;
  }
  return real_fopen(remap_proc_path(pathname), mode);
}

FILE *fopen64(const char *pathname, const char *mode) {
  typedef FILE *(*fopen64_fn)(const char *, const char *);
  static fopen64_fn real_fopen64 = NULL;
  if (!real_fopen64) real_fopen64 = (fopen64_fn)real_dlsym_lookup(RTLD_NEXT, "fopen64");
  if (is_cpu_online_path(pathname) && mode && mode[0] == 'r') {
    FILE *mem = fmemopen(cached_cpu_online, strlen(cached_cpu_online), "r");
    if (mem) return mem;
  }
  return real_fopen64(remap_proc_path(pathname), mode);
}

int open(const char *pathname, int flags, ...) {
  typedef int (*open_fn)(const char *, int, ...);
  static open_fn real_open = NULL;
  if (!real_open) real_open = (open_fn)real_dlsym_lookup(RTLD_NEXT, "open");

  if (is_cpu_online_path(pathname) && (flags & O_ACCMODE) == O_RDONLY) {
    int fd = make_cpu_online_fd();
    if (fd >= 0) return fd;
  }

  mode_t mode = 0;
  if (flags & (O_CREAT | O_TMPFILE)) {
    va_list ap;
    va_start(ap, flags);
    mode = va_arg(ap, mode_t);
    va_end(ap);
    return real_open(remap_proc_path(pathname), flags, mode);
  }
  return real_open(remap_proc_path(pathname), flags);
}

int __open_2(const char *pathname, int flags) {
  typedef int (*open2_fn)(const char *, int);
  static open2_fn real_open2 = NULL;
  if (!real_open2) real_open2 = (open2_fn)real_dlsym_lookup(RTLD_NEXT, "__open_2");
  if (is_cpu_online_path(pathname) && (flags & O_ACCMODE) == O_RDONLY) {
    int fd = make_cpu_online_fd();
    if (fd >= 0) return fd;
  }
  return real_open2(remap_proc_path(pathname), flags);
}

int open64(const char *pathname, int flags, ...) {
  typedef int (*open64_fn)(const char *, int, ...);
  static open64_fn real_open64 = NULL;
  if (!real_open64) real_open64 = (open64_fn)real_dlsym_lookup(RTLD_NEXT, "open64");

  if (is_cpu_online_path(pathname) && (flags & O_ACCMODE) == O_RDONLY) {
    int fd = make_cpu_online_fd();
    if (fd >= 0) return fd;
  }

  mode_t mode = 0;
  if (flags & (O_CREAT | O_TMPFILE)) {
    va_list ap;
    va_start(ap, flags);
    mode = va_arg(ap, mode_t);
    va_end(ap);
    return real_open64(remap_proc_path(pathname), flags, mode);
  }
  return real_open64(remap_proc_path(pathname), flags);
}

int __open64_2(const char *pathname, int flags) {
  typedef int (*open64_2_fn)(const char *, int);
  static open64_2_fn real_open64_2 = NULL;
  if (!real_open64_2) real_open64_2 = (open64_2_fn)real_dlsym_lookup(RTLD_NEXT, "__open64_2");
  if (is_cpu_online_path(pathname) && (flags & O_ACCMODE) == O_RDONLY) {
    int fd = make_cpu_online_fd();
    if (fd >= 0) return fd;
  }
  return real_open64_2(remap_proc_path(pathname), flags);
}

int openat(int dirfd, const char *pathname, int flags, ...) {
  typedef int (*openat_fn)(int, const char *, int, ...);
  static openat_fn real_openat = NULL;
  if (!real_openat) real_openat = (openat_fn)real_dlsym_lookup(RTLD_NEXT, "openat");

  if (is_cpu_online_path(pathname) && (flags & O_ACCMODE) == O_RDONLY) {
    int fd = make_cpu_online_fd();
    if (fd >= 0) return fd;
  }

  mode_t mode = 0;
  if (flags & (O_CREAT | O_TMPFILE)) {
    va_list ap;
    va_start(ap, flags);
    mode = va_arg(ap, mode_t);
    va_end(ap);
    return real_openat(dirfd, remap_proc_path(pathname), flags, mode);
  }
  return real_openat(dirfd, remap_proc_path(pathname), flags);
}

int __openat_2(int dirfd, const char *pathname, int flags) {
  typedef int (*openat2_fn)(int, const char *, int);
  static openat2_fn real_openat2 = NULL;
  if (!real_openat2) real_openat2 = (openat2_fn)real_dlsym_lookup(RTLD_NEXT, "__openat_2");
  if (is_cpu_online_path(pathname) && (flags & O_ACCMODE) == O_RDONLY) {
    int fd = make_cpu_online_fd();
    if (fd >= 0) return fd;
  }
  return real_openat2(dirfd, remap_proc_path(pathname), flags);
}

int openat64(int dirfd, const char *pathname, int flags, ...) {
  typedef int (*openat64_fn)(int, const char *, int, ...);
  static openat64_fn real_openat64 = NULL;
  if (!real_openat64) real_openat64 = (openat64_fn)real_dlsym_lookup(RTLD_NEXT, "openat64");

  if (is_cpu_online_path(pathname) && (flags & O_ACCMODE) == O_RDONLY) {
    int fd = make_cpu_online_fd();
    if (fd >= 0) return fd;
  }

  mode_t mode = 0;
  if (flags & (O_CREAT | O_TMPFILE)) {
    va_list ap;
    va_start(ap, flags);
    mode = va_arg(ap, mode_t);
    va_end(ap);
    return real_openat64(dirfd, remap_proc_path(pathname), flags, mode);
  }
  return real_openat64(dirfd, remap_proc_path(pathname), flags);
}

int __openat64_2(int dirfd, const char *pathname, int flags) {
  typedef int (*openat64_2_fn)(int, const char *, int);
  static openat64_2_fn real_openat64_2 = NULL;
  if (!real_openat64_2) real_openat64_2 = (openat64_2_fn)real_dlsym_lookup(RTLD_NEXT, "__openat64_2");
  if (is_cpu_online_path(pathname) && (flags & O_ACCMODE) == O_RDONLY) {
    int fd = make_cpu_online_fd();
    if (fd >= 0) return fd;
  }
  return real_openat64_2(dirfd, remap_proc_path(pathname), flags);
}

/* --- Native C Speech Dispatcher (libspeechd.so.2) for Chromium TtsPlatformImplLinux --- */
typedef struct {
  char *name;
  char *language;
  char *variant;
} SPDVoice;

void *spd_open(const char *client_name, const char *connection_name,
               const char *user_name, int mode) {
  (void)client_name;
  (void)connection_name;
  (void)user_name;
  (void)mode;
  return calloc(1, 4096);
}

void spd_close(void *conn) {
  if (conn) free(conn);
}

static char g_speech_module[64] = "(de-DE)";

static const struct {
  const char *name;
  const char *lang;
} kSpeechVoices[] = {
    {"Google Deutsch", "de-DE"},
    {"Google US English", "en-US"},
    {"Google UK English Female", "en-GB"},
    {"Google UK English Male", "en-GB"},
    {"Google Français", "fr-FR"},
    {"Google Español", "es-ES"},
    {"Google Tiếng Việt", "vi-VN"},
};

char **spd_list_modules(void *conn) {
  (void)conn;
  /* Chrome displays "voice.name + ' ' + module", so the module is the locale suffix. */
  static const char *kModules[] = {
      "(de-DE)", "(en-US)", "(en-GB)", "(fr-FR)", "(es-ES)", "(vi-VN)",
  };
  size_t count = sizeof(kModules) / sizeof(kModules[0]);
  char **mods = (char **)calloc(count + 1, sizeof(char *));
  if (!mods) return NULL;
  for (size_t i = 0; i < count; i++) mods[i] = strdup(kModules[i]);
  return mods;
}

SPDVoice **spd_list_synthesis_voices(void *conn) {
  (void)conn;
  const char *want = g_speech_module;
  const char *lang = want;
  if (want[0] == '(' && want[strlen(want) - 1] == ')') {
    lang = want + 1;
  }
  size_t matches = 0;
  for (size_t i = 0; i < sizeof(kSpeechVoices) / sizeof(kSpeechVoices[0]); i++) {
    if (strncmp(kSpeechVoices[i].lang, lang, strlen(kSpeechVoices[i].lang)) == 0) matches++;
  }
  SPDVoice **list = (SPDVoice **)calloc(matches + 1, sizeof(SPDVoice *));
  if (!list) return NULL;
  size_t n = 0;
  for (size_t i = 0; i < sizeof(kSpeechVoices) / sizeof(kSpeechVoices[0]); i++) {
    if (strncmp(kSpeechVoices[i].lang, lang, strlen(kSpeechVoices[i].lang)) != 0) continue;
    SPDVoice *v = (SPDVoice *)malloc(sizeof(SPDVoice));
    if (!v) break;
    v->name = (char *)kSpeechVoices[i].name;
    v->language = (char *)kSpeechVoices[i].lang;
    v->variant = (char *)"none";
    list[n++] = v;
  }
  return list;
}

int spd_say(void *conn, int priority, const char *text) {
  (void)conn;
  (void)priority;
  (void)text;
  return 1;
}

int spd_stop(void *conn) {
  (void)conn;
  return 0;
}

int spd_cancel(void *conn) {
  (void)conn;
  return 0;
}

int spd_pause(void *conn) {
  (void)conn;
  return 0;
}

int spd_resume(void *conn) {
  (void)conn;
  return 0;
}

int spd_set_notification_on(void *conn, int notification) {
  (void)conn;
  (void)notification;
  return 0;
}

int spd_set_voice_rate(void *conn, signed int rate) {
  (void)conn;
  (void)rate;
  return 0;
}

int spd_set_voice_pitch(void *conn, signed int pitch) {
  (void)conn;
  (void)pitch;
  return 0;
}

int spd_set_synthesis_voice(void *conn, const char *voice_name) {
  (void)conn;
  (void)voice_name;
  return 0;
}

int spd_set_output_module(void *conn, const char *output_module) {
  (void)conn;
  if (output_module && *output_module) {
    snprintf(g_speech_module, sizeof(g_speech_module), "%s", output_module);
  }
  return 0;
}

int spd_set_language(void *conn, const char *language) {
  (void)conn;
  (void)language;
  return 0;
}

void *dlopen(const char *filename, int flags) {
  typedef void *(*dlopen_fn)(const char *, int);
  static dlopen_fn real_dlopen = NULL;
  if (!real_dlopen) real_dlopen = (dlopen_fn)real_dlsym_lookup(RTLD_NEXT, "dlopen");
  if (filename && strstr(filename, "libspeechd.so") != NULL) {
    return real_dlopen("/usr/local/lib/libpersona_engine.so", flags);
  }
  return real_dlopen(filename, flags);
}

/* --- Native C/EGL WebGL Hardware Vendor/Renderer Hook --- */
typedef const unsigned char *(*glGetString_fn)(unsigned int name);
typedef void *(*eglGetProcAddress_fn)(const char *procname);

static glGetString_fn real_glGetString = NULL;
static eglGetProcAddress_fn real_eglGetProcAddress = NULL;

static const unsigned char *persona_glGetString(unsigned int name) {
  if (!real_glGetString) return NULL;
  const unsigned char *orig = real_glGetString(name);
  if (!orig) return NULL;
  if (name == 0x1F00 || name == 0x9245) {
    const char *v = getenv("PERSONA_WEBGL_VENDOR");
    return (const unsigned char *)(v && *v ? v : "Google Inc. (Intel)");
  }
  if (name == 0x1F01 || name == 0x9246) {
    const char *r = getenv("PERSONA_WEBGL_RENDERER");
    return (const unsigned char *)(r && *r
                                       ? r
                                       : "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)");
  }
  return orig;
}

static void *persona_eglGetProcAddress(const char *procname) {
  if (!real_eglGetProcAddress) return NULL;
  void *sym = real_eglGetProcAddress(procname);
  if (sym && procname &&
      (strcmp(procname, "glGetString") == 0 || strcmp(procname, "GL_GetString") == 0)) {
    real_glGetString = (glGetString_fn)sym;
    return (void *)persona_glGetString;
  }
  return sym;
}

void *dlsym(void *handle, const char *symbol) {
  void *sym = real_dlsym_lookup(handle, symbol);
  if (!sym || !symbol) return sym;

  if (strcmp(symbol, "eglGetProcAddress") == 0 || strcmp(symbol, "EGL_GetProcAddress") == 0) {
    real_eglGetProcAddress = (eglGetProcAddress_fn)sym;
    return (void *)persona_eglGetProcAddress;
  }
  if (strcmp(symbol, "glGetString") == 0 || strcmp(symbol, "GL_GetString") == 0) {
    real_glGetString = (glGetString_fn)sym;
    return (void *)persona_glGetString;
  }
  return sym;
}

/* --- Native C Socket Isolation & Local STUN Responder Redirection --- */
#define LOCAL_STUN_PORT 34780
#define STUN_RING_SIZE 64

struct stun_tx_entry {
  uint8_t txid[12];
  struct sockaddr_in peer;
  int valid;
};

static pthread_mutex_t stun_mu = PTHREAD_MUTEX_INITIALIZER;
static struct stun_tx_entry stun_ring[STUN_RING_SIZE];
static int stun_ring_idx = 0;
static struct sockaddr_in last_stun_peer[1024];
static int has_last_stun_peer[1024];
static uint32_t saved_bind_ip[1024];

static int is_stun_binding_request(const void *buf, size_t len) {
  if (!buf || len < 20) return 0;
  const uint8_t *b = (const uint8_t *)buf;
  return (b[0] == 0x00 && b[1] == 0x01 &&
          b[4] == 0x21 && b[5] == 0x12 && b[6] == 0xa4 && b[7] == 0x42);
}

static void record_stun_tx(int sockfd, const void *buf, const struct sockaddr_in *peer) {
  const uint8_t *b = (const uint8_t *)buf;
  pthread_mutex_lock(&stun_mu);
  int slot = stun_ring_idx;
  stun_ring_idx = (stun_ring_idx + 1) % STUN_RING_SIZE;
  memcpy(stun_ring[slot].txid, b + 8, 12);
  stun_ring[slot].peer = *peer;
  stun_ring[slot].valid = 1;
  if (sockfd >= 0) {
    last_stun_peer[sockfd & 1023] = *peer;
    has_last_stun_peer[sockfd & 1023] = 1;
  }
  pthread_mutex_unlock(&stun_mu);
}

static int restore_stun_peer(int sockfd, const void *buf, size_t len, struct sockaddr_in *out) {
  int found = 0;
  pthread_mutex_lock(&stun_mu);
  if (buf && len >= 20) {
    const uint8_t *b = (const uint8_t *)buf;
    for (int i = 0; i < STUN_RING_SIZE; i++) {
      if (stun_ring[i].valid && memcmp(stun_ring[i].txid, b + 8, 12) == 0) {
        *out = stun_ring[i].peer;
        found = 1;
        break;
      }
    }
  }
  if (!found && sockfd >= 0 && has_last_stun_peer[sockfd & 1023]) {
    *out = last_stun_peer[sockfd & 1023];
    found = 1;
  }
  pthread_mutex_unlock(&stun_mu);
  return found;
}

static int get_sock_type(int sockfd) {
  int type = 0;
  socklen_t len = sizeof(type);
  if (getsockopt(sockfd, SOL_SOCKET, SO_TYPE, &type, &len) != 0) return 0;
  return type;
}

static int is_private_or_loopback_ipv4(uint32_t ip, int *is_loopback_out) {
  uint8_t a = (uint8_t)((ip >> 24) & 0xff);
  uint8_t b = (uint8_t)((ip >> 16) & 0xff);
  int loop = (a == 127) || (ip == 0);
  if (is_loopback_out) *is_loopback_out = loop;
  if (loop) return 1;
  if (a == 10) return 1;
  if (a == 172 && b >= 16 && b <= 31) return 1;
  if (a == 192 && b == 168) return 1;
  if (a == 169 && b == 254) return 1;
  if (a == 100 && b >= 64 && b <= 127) return 1;
  return 0;
}

static int is_allowed_local_port(uint16_t port) {
  if (port == 53 || port == 6099 || port == LOCAL_STUN_PORT) return 1;
  int proxy_port = get_allowed_proxy_port();
  if (proxy_port > 0 && port == (uint16_t)proxy_port) return 1;
  return 0;
}

int bind(int sockfd, const struct sockaddr *addr, socklen_t addrlen) {
  typedef int (*bind_fn)(int, const struct sockaddr *, socklen_t);
  static bind_fn real_bind = NULL;
  if (!real_bind) real_bind = (bind_fn)real_dlsym_lookup(RTLD_NEXT, "bind");

  if (addr && addr->sa_family == AF_INET &&
      addrlen >= (socklen_t)sizeof(struct sockaddr_in) &&
      get_sock_type(sockfd) == SOCK_DGRAM) {
    const struct sockaddr_in *sin = (const struct sockaddr_in *)addr;
    uint32_t ip = ntohl(sin->sin_addr.s_addr);
    if (ip != INADDR_ANY && (ip >> 24) != 127) {
      struct sockaddr_in any_addr = *sin;
      any_addr.sin_addr.s_addr = htonl(INADDR_ANY);
      int rc = real_bind(sockfd, (const struct sockaddr *)&any_addr, sizeof(any_addr));
      if (rc == 0 && sockfd >= 0) {
        pthread_mutex_lock(&stun_mu);
        saved_bind_ip[sockfd & 1023] = sin->sin_addr.s_addr;
        pthread_mutex_unlock(&stun_mu);
      }
      return rc;
    }
  }
  return real_bind(sockfd, addr, addrlen);
}

int getsockname(int sockfd, struct sockaddr *addr, socklen_t *addrlen) {
  typedef int (*getsockname_fn)(int, struct sockaddr *, socklen_t *);
  static getsockname_fn real_getsockname = NULL;
  if (!real_getsockname) {
    real_getsockname = (getsockname_fn)real_dlsym_lookup(RTLD_NEXT, "getsockname");
  }
  int rc = real_getsockname(sockfd, addr, addrlen);
  if (rc == 0 && sockfd >= 0 && addr && addrlen &&
      *addrlen >= (socklen_t)sizeof(struct sockaddr_in) &&
      addr->sa_family == AF_INET && get_sock_type(sockfd) == SOCK_DGRAM) {
    struct sockaddr_in *sin = (struct sockaddr_in *)addr;
    if (sin->sin_addr.s_addr == htonl(INADDR_ANY)) {
      pthread_mutex_lock(&stun_mu);
      uint32_t saved = saved_bind_ip[sockfd & 1023];
      pthread_mutex_unlock(&stun_mu);
      if (saved != 0) {
        sin->sin_addr.s_addr = saved;
      }
    }
  }
  return rc;
}

int connect(int sockfd, const struct sockaddr *addr, socklen_t addrlen) {
  typedef int (*connect_fn)(int, const struct sockaddr *, socklen_t);
  static connect_fn real_connect = NULL;
  if (!real_connect) real_connect = (connect_fn)real_dlsym_lookup(RTLD_NEXT, "connect");

  if (!addr) return real_connect(sockfd, addr, addrlen);

  int stype = get_sock_type(sockfd);

  if (addr->sa_family == AF_INET && addrlen >= (socklen_t)sizeof(struct sockaddr_in)) {
    const struct sockaddr_in *sin = (const struct sockaddr_in *)addr;
    uint32_t ip = ntohl(sin->sin_addr.s_addr);
    uint16_t port = ntohs(sin->sin_port);
    int is_loopback = 0;
    int is_priv = is_private_or_loopback_ipv4(ip, &is_loopback);

    if (stype == SOCK_STREAM && is_priv) {
      if (!is_loopback || !is_allowed_local_port(port)) {
        struct sockaddr_in redirected;
        memset(&redirected, 0, sizeof(redirected));
        redirected.sin_family = AF_INET;
        redirected.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        redirected.sin_port = htons(59998);
        return real_connect(sockfd, (const struct sockaddr *)&redirected, sizeof(redirected));
      }
    }
  } else if (addr->sa_family == AF_INET6 && addrlen >= (socklen_t)sizeof(struct sockaddr_in6)) {
    const struct sockaddr_in6 *sin6 = (const struct sockaddr_in6 *)addr;
    uint16_t port = ntohs(sin6->sin6_port);
    int is_loopback = IN6_IS_ADDR_LOOPBACK(&sin6->sin6_addr) || IN6_IS_ADDR_UNSPECIFIED(&sin6->sin6_addr);
    int is_priv = is_loopback || ((sin6->sin6_addr.s6_addr[0] & 0xfe) == 0xfc);

    if (IN6_IS_ADDR_V4MAPPED(&sin6->sin6_addr)) {
      uint32_t ip4 =
          ((uint32_t)sin6->sin6_addr.s6_addr[12] << 24) |
          ((uint32_t)sin6->sin6_addr.s6_addr[13] << 16) |
          ((uint32_t)sin6->sin6_addr.s6_addr[14] << 8) |
          ((uint32_t)sin6->sin6_addr.s6_addr[15]);
      is_priv = is_private_or_loopback_ipv4(ip4, &is_loopback);
    }

    if (stype == SOCK_DGRAM && should_block_udp() && !is_loopback && port != 53) {
      errno = ENETUNREACH;
      return -1;
    }

    if (stype == SOCK_STREAM && is_priv) {
      if (!is_loopback || !is_allowed_local_port(port)) {
        struct sockaddr_in6 redirected = *sin6;
        redirected.sin6_port = htons(59998);
        return real_connect(sockfd, (const struct sockaddr *)&redirected, sizeof(redirected));
      }
    }
  }

  return real_connect(sockfd, addr, addrlen);
}

ssize_t send(int sockfd, const void *buf, size_t len, int flags) {
  typedef ssize_t (*send_fn)(int, const void *, size_t, int);
  static send_fn real_send = NULL;
  if (!real_send) real_send = (send_fn)real_dlsym_lookup(RTLD_NEXT, "send");

  if (should_block_udp() && get_sock_type(sockfd) == SOCK_DGRAM) {
    struct sockaddr_storage peer;
    socklen_t plen = sizeof(peer);
    if (getpeername(sockfd, (struct sockaddr *)&peer, &plen) == 0) {
      if (peer.ss_family == AF_INET) {
        struct sockaddr_in *sin = (struct sockaddr_in *)&peer;
        uint32_t ip = ntohl(sin->sin_addr.s_addr);
        uint16_t port = ntohs(sin->sin_port);
        if ((ip >> 24) != 127 && ip != 0 && port != 53) {
          errno = ENETUNREACH;
          return -1;
        }
      }
    }
  }
  return real_send(sockfd, buf, len, flags);
}

ssize_t sendto(int sockfd, const void *buf, size_t len, int flags,
               const struct sockaddr *dest_addr, socklen_t addrlen) {
  typedef ssize_t (*sendto_fn)(int, const void *, size_t, int, const struct sockaddr *, socklen_t);
  static sendto_fn real_sendto = NULL;
  if (!real_sendto) real_sendto = (sendto_fn)real_dlsym_lookup(RTLD_NEXT, "sendto");

  if (dest_addr && should_block_udp() && get_sock_type(sockfd) == SOCK_DGRAM) {
    if (dest_addr->sa_family == AF_INET && addrlen >= (socklen_t)sizeof(struct sockaddr_in)) {
      const struct sockaddr_in *sin = (const struct sockaddr_in *)dest_addr;
      uint32_t ip = ntohl(sin->sin_addr.s_addr);
      uint16_t port = ntohs(sin->sin_port);
      if (((ip >> 24) != 127) && ip != 0 && port != 53) {
        if (is_stun_binding_request(buf, len)) {
          record_stun_tx(sockfd, buf, sin);
          struct sockaddr_in local_stun;
          memset(&local_stun, 0, sizeof(local_stun));
          local_stun.sin_family = AF_INET;
          local_stun.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
          local_stun.sin_port = htons(LOCAL_STUN_PORT);
          return real_sendto(sockfd, buf, len, flags,
                             (const struct sockaddr *)&local_stun, sizeof(local_stun));
        }
        errno = ENETUNREACH;
        return -1;
      }
    } else if (dest_addr->sa_family == AF_INET6 && addrlen >= (socklen_t)sizeof(struct sockaddr_in6)) {
      const struct sockaddr_in6 *sin6 = (const struct sockaddr_in6 *)dest_addr;
      uint16_t port = ntohs(sin6->sin6_port);
      if (!IN6_IS_ADDR_LOOPBACK(&sin6->sin6_addr) && port != 53) {
        errno = ENETUNREACH;
        return -1;
      }
    }
  }

  return real_sendto(sockfd, buf, len, flags, dest_addr, addrlen);
}

ssize_t recvfrom(int sockfd, void *buf, size_t len, int flags,
                 struct sockaddr *src_addr, socklen_t *addrlen) {
  typedef ssize_t (*recvfrom_fn)(int, void *, size_t, int, struct sockaddr *, socklen_t *);
  static recvfrom_fn real_recvfrom = NULL;
  if (!real_recvfrom) real_recvfrom = (recvfrom_fn)real_dlsym_lookup(RTLD_NEXT, "recvfrom");

  ssize_t n = real_recvfrom(sockfd, buf, len, flags, src_addr, addrlen);
  if (n > 0 && src_addr && addrlen && *addrlen >= (socklen_t)sizeof(struct sockaddr_in) &&
      src_addr->sa_family == AF_INET) {
    struct sockaddr_in *sin = (struct sockaddr_in *)src_addr;
    if (ntohl(sin->sin_addr.s_addr) == INADDR_LOOPBACK &&
        ntohs(sin->sin_port) == LOCAL_STUN_PORT) {
      struct sockaddr_in orig_peer;
      if (restore_stun_peer(sockfd, buf, (size_t)n, &orig_peer)) {
        *sin = orig_peer;
      }
    }
  }
  return n;
}

ssize_t sendmsg(int sockfd, const struct msghdr *msg, int flags) {
  typedef ssize_t (*sendmsg_fn)(int, const struct msghdr *, int);
  static sendmsg_fn real_sendmsg = NULL;
  if (!real_sendmsg) real_sendmsg = (sendmsg_fn)real_dlsym_lookup(RTLD_NEXT, "sendmsg");

  if (msg && msg->msg_name && should_block_udp() && get_sock_type(sockfd) == SOCK_DGRAM) {
    const struct sockaddr *dest = (const struct sockaddr *)msg->msg_name;
    if (dest->sa_family == AF_INET && msg->msg_namelen >= (socklen_t)sizeof(struct sockaddr_in)) {
      const struct sockaddr_in *sin = (const struct sockaddr_in *)dest;
      uint32_t ip = ntohl(sin->sin_addr.s_addr);
      uint16_t port = ntohs(sin->sin_port);
      if (((ip >> 24) != 127) && ip != 0 && port != 53) {
        if (msg->msg_iovlen > 0 && msg->msg_iov &&
            is_stun_binding_request(msg->msg_iov[0].iov_base, msg->msg_iov[0].iov_len)) {
          record_stun_tx(sockfd, msg->msg_iov[0].iov_base, sin);
          struct sockaddr_in local_stun;
          memset(&local_stun, 0, sizeof(local_stun));
          local_stun.sin_family = AF_INET;
          local_stun.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
          local_stun.sin_port = htons(LOCAL_STUN_PORT);
          struct msghdr copy = *msg;
          copy.msg_name = &local_stun;
          copy.msg_namelen = sizeof(local_stun);
          return real_sendmsg(sockfd, &copy, flags);
        }
        errno = ENETUNREACH;
        return -1;
      }
    }
  }
  return real_sendmsg(sockfd, msg, flags);
}

ssize_t recvmsg(int sockfd, struct msghdr *msg, int flags) {
  typedef ssize_t (*recvmsg_fn)(int, struct msghdr *, int);
  static recvmsg_fn real_recvmsg = NULL;
  if (!real_recvmsg) real_recvmsg = (recvmsg_fn)real_dlsym_lookup(RTLD_NEXT, "recvmsg");

  ssize_t n = real_recvmsg(sockfd, msg, flags);
  if (n > 0 && msg && msg->msg_name &&
      msg->msg_namelen >= (socklen_t)sizeof(struct sockaddr_in)) {
    struct sockaddr *src = (struct sockaddr *)msg->msg_name;
    if (src->sa_family == AF_INET) {
      struct sockaddr_in *sin = (struct sockaddr_in *)src;
      if (ntohl(sin->sin_addr.s_addr) == INADDR_LOOPBACK &&
          ntohs(sin->sin_port) == LOCAL_STUN_PORT) {
        const void *buf = (msg->msg_iovlen > 0 && msg->msg_iov) ? msg->msg_iov[0].iov_base : NULL;
        size_t blen = (msg->msg_iovlen > 0 && msg->msg_iov) ? msg->msg_iov[0].iov_len : 0;
        struct sockaddr_in orig_peer;
        if (restore_stun_peer(sockfd, buf, blen, &orig_peer)) {
          *sin = orig_peer;
        }
      }
    }
  }
  return n;
}
