#!/bin/bash
# FluencyOS .deb post-install (electron-builder.yml → deb.afterInstall).
# electron-builder's default script, except for the sandbox helper below.

if type update-alternatives >/dev/null 2>&1; then
    # Remove a previous link that doesn't use update-alternatives
    if [ -L '/usr/bin/fluencyos' -a -e '/usr/bin/fluencyos' -a "$(readlink '/usr/bin/fluencyos')" != '/etc/alternatives/fluencyos' ]; then
        rm -f '/usr/bin/fluencyos'
    fi
    update-alternatives --install '/usr/bin/fluencyos' 'fluencyos' '/opt/FluencyOS/fluencyos' 100 || ln -sf '/opt/FluencyOS/fluencyos' '/usr/bin/fluencyos'
else
    ln -sf '/opt/FluencyOS/fluencyos' '/usr/bin/fluencyos'
fi

# Chromium's setuid sandbox helper, always. The default script only makes it
# setuid where `unshare --user true` fails — but on Ubuntu 24.04 and later
# that test passes while AppArmor still denies the namespace sandbox to
# ordinary apps, and FluencyOS would abort at launch ("The SUID sandbox helper
# binary was found, but is not configured correctly"). Setuid root, Chromium
# uses the helper instead and keeps its sandbox. Google Chrome's own package
# installs its helper the same way.
chown root:root '/opt/FluencyOS/chrome-sandbox' || true
chmod 4755 '/opt/FluencyOS/chrome-sandbox' || true

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
