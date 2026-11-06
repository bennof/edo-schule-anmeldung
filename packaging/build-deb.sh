#!/bin/sh
# Debian package of the server: build-deb.sh <binary> <version> <arch> <out-dir>
# (make deb). Uses only dpkg-deb; the binary is static (musl), so the
# package has no library dependencies.
set -eu
bin=$1 version=$2 arch=$3 out=$4
here=$(cd "$(dirname "$0")" && pwd)
root=$(mktemp -d)
chmod 755 "$root"
trap 'rm -rf "$root"' EXIT

install -D -m 755 "$bin" "$root/usr/bin/edo-anmeldung-server"
install -D -m 644 "$here/edo-anmeldung-server.service" "$root/usr/lib/systemd/system/edo-anmeldung-server.service"
install -D -m 600 "$here/config.env" "$root/etc/edo-anmeldung-server/config.env"
install -d "$root/DEBIAN"
for script in postinst prerm postrm; do install -m 755 "$here/debian/$script" "$root/DEBIAN/$script"; done
echo /etc/edo-anmeldung-server/config.env > "$root/DEBIAN/conffiles"
cat > "$root/DEBIAN/control" <<CONTROL
Package: edo-anmeldung-server
Version: $version
Architecture: $arch
Maintainer: Benjamin Benno Falkner <benno@falkner.xyz>
Depends: systemd, passwd
Section: web
Priority: optional
Homepage: https://github.com/bennof/edo-schule-anmeldung
Installed-Size: $(du -sk "$root/usr" | cut -f1)
Description: Online-Anmeldung für Schulen: Server (API und Anmeldeseite)
 Öffentlicher Server des Anmeldesystems: Terminbuchung und Anmeldeformular,
 Daten in SharePoint (Microsoft Graph). Der Dienst wird nicht automatisch
 aktiviert; Einstellungen in /etc/edo-anmeldung-server/config.env.
CONTROL

mkdir -p "$out"
dpkg-deb --root-owner-group --build "$root" "$out/edo-anmeldung-server_${version}_${arch}.deb" >/dev/null
echo "$out/edo-anmeldung-server_${version}_${arch}.deb"
