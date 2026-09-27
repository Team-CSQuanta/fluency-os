// electron-builder afterPack hook (electron-builder.yml → afterPack).
//
// On Linux, puts a small launcher script where the app's executable was, and
// moves the real Electron binary to `fluencyos.bin`.
//
// Why: Chromium's sandbox needs one of two things — unprivileged user
// namespaces, or a setuid-root helper (chrome-sandbox). The .deb installs the
// helper setuid (build/linux/after-install.sh). An AppImage cannot: it is a
// read-only image mounted by the user. So where namespaces are unavailable —
// Ubuntu 24.04 and later restrict them through AppArmor, some distributions
// switch them off — an AppImage aborts at launch with "The SUID sandbox helper
// binary was found, but is not configured correctly".
//
// The only way around that is `--no-sandbox` on the command line: Chromium
// sets its sandbox up before any of the app's own code runs, so the app
// cannot turn it off itself. The launcher adds the flag in exactly that case —
// running as an AppImage on a system without usable namespaces — and nowhere
// else.

const fs = require('node:fs');
const path = require('node:path');

const LAUNCHER = `#!/bin/sh
# FluencyOS launcher — see scripts/after-pack.cjs in the source for why.
HERE="$(dirname "$(readlink -f "$0")")"
BIN="$HERE/fluencyos.bin"

namespaces_unusable() {
  [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ] && return 0
  [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)" = "0" ] && return 0
  [ "$(cat /proc/sys/user/max_user_namespaces 2>/dev/null)" = "0" ] && return 0
  return 1
}

if [ -n "$APPIMAGE" ] && namespaces_unusable; then
  exec "$BIN" --no-sandbox "$@"
fi
exec "$BIN" "$@"
`;

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const executable = path.join(context.appOutDir, context.packager.executableName);
  const real = `${executable}.bin`;
  if (!fs.existsSync(real)) fs.renameSync(executable, real);
  fs.writeFileSync(executable, LAUNCHER, { mode: 0o755 });
};
