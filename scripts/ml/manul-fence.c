// manul-fence (Linux): run a command that can only read the system folders and the paths given, and only write the
// --rw ones — Landlock (Linux 5.13+), no privileges needed. Manul runs the agent's shell commands through it, so they
// can't reach the user's home folder or other projects. On a kernel without Landlock it warns and runs unfenced.
//   manul-fence --rw /project --rw /tmp --ro /opt/Manul/resources -- /bin/bash -c "…"
// Landlock's ABI is stable: the constants are defined here so the build needs no kernel headers.
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#define SYS_landlock_create_ruleset_ 444
#define SYS_landlock_add_rule_ 445
#define SYS_landlock_restrict_self_ 446
#define LANDLOCK_CREATE_RULESET_VERSION (1U << 0)
#define LANDLOCK_RULE_PATH_BENEATH 1

#define FS_EXECUTE (1ULL << 0)
#define FS_WRITE_FILE (1ULL << 1)
#define FS_READ_FILE (1ULL << 2)
#define FS_READ_DIR (1ULL << 3)
#define FS_REFER (1ULL << 13)
#define FS_TRUNCATE (1ULL << 14)
#define FS_IOCTL_DEV (1ULL << 15)
#define FS_FILE_RIGHTS (FS_EXECUTE | FS_WRITE_FILE | FS_READ_FILE | FS_TRUNCATE | FS_IOCTL_DEV)

struct ruleset_attr { uint64_t handled_access_fs; };
struct path_beneath_attr { uint64_t allowed_access; int32_t parent_fd; } __attribute__((packed));

static uint64_t handled;

static void rule(int ruleset, const char *path, uint64_t access) {
  int fd = open(path, O_PATH | O_CLOEXEC);
  if (fd < 0) return; // a folder that doesn't exist here (e.g. /lib64) needs no rule
  struct stat st;
  if (fstat(fd, &st) == 0 && !S_ISDIR(st.st_mode)) access &= FS_FILE_RIGHTS;
  struct path_beneath_attr pb = {access & handled, fd};
  if (syscall(SYS_landlock_add_rule_, ruleset, LANDLOCK_RULE_PATH_BENEATH, &pb, 0)) {
    fprintf(stderr, "manul-fence: can't add %s: %s\n", path, strerror(errno));
    exit(126);
  }
  close(fd);
}

int main(int argc, char **argv) {
  int i = 1;
  const char *rw[64], *ro[64];
  int nrw = 0, nro = 0;
  for (; i < argc; i++) {
    if (!strcmp(argv[i], "--")) { i++; break; }
    if (!strcmp(argv[i], "--rw") && i + 1 < argc && nrw < 64) rw[nrw++] = argv[++i];
    else if (!strcmp(argv[i], "--ro") && i + 1 < argc && nro < 64) ro[nro++] = argv[++i];
    else { fprintf(stderr, "usage: manul-fence [--rw path]… [--ro path]… -- command [args…]\n"); return 2; }
  }
  if (i >= argc) { fprintf(stderr, "manul-fence: no command\n"); return 2; }

  long abi = syscall(SYS_landlock_create_ruleset_, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
  if (abi < 1) {
    fprintf(stderr, "manul-fence: this kernel has no Landlock (Linux 5.13+); running unfenced\n");
    execvp(argv[i], argv + i);
    perror("manul-fence"); return 127;
  }
  handled = (1ULL << 13) - 1; // ABI 1: execute … make_sym
  if (abi >= 2) handled |= FS_REFER;
  if (abi >= 3) handled |= FS_TRUNCATE;
  if (abi >= 5) handled |= FS_IOCTL_DEV;
  struct ruleset_attr attr = {handled};
  int ruleset = (int)syscall(SYS_landlock_create_ruleset_, &attr, sizeof attr, 0);
  if (ruleset < 0) { perror("manul-fence: landlock"); return 126; }

  const uint64_t READ = FS_EXECUTE | FS_READ_FILE | FS_READ_DIR;
  const char *system[] = {"/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", "/libx32", "/etc", "/opt", "/run", "/var",
                          "/proc", "/sys", "/snap", "/nix", NULL};
  for (int k = 0; system[k]; k++) rule(ruleset, system[k], READ);
  rule(ruleset, "/dev", handled); // /dev/null, /dev/tty, /dev/urandom
  for (int k = 0; k < nro; k++) rule(ruleset, ro[k], READ);
  for (int k = 0; k < nrw; k++) rule(ruleset, rw[k], handled);

  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) { perror("manul-fence: no_new_privs"); return 126; }
  if (syscall(SYS_landlock_restrict_self_, ruleset, 0)) { perror("manul-fence: restrict"); return 126; }
  close(ruleset);
  execvp(argv[i], argv + i);
  perror("manul-fence");
  return 127;
}
