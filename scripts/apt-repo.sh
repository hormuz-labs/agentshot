#!/usr/bin/env bash
# Build Manul's signed apt repository for one release. Runs in CI on Ubuntu (needs apt-utils + gpg).
#   scripts/apt-repo.sh <dir with .deb files> <out dir> <gpg key id> <release tag>
# The out dir holds only small files: package lists, signatures, the public key and a `_redirects` file.
# The .deb files themselves stay on GitHub Releases: `pool/<tag>/<file>` redirects there, and apt follows it.
# Served by Cloudflare Pages at apt.manul.si (free, nothing billable). Users run:
#   curl -fsSL https://apt.manul.si/manul.gpg | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/manul.gpg &&
#   echo "deb [signed-by=/usr/share/keyrings/manul.gpg] https://apt.manul.si stable main" | sudo tee /etc/apt/sources.list.d/manul.list &&
#   sudo apt update && sudo apt install manul
set -eu
DEBS=$1
OUT=$2
KEY=$3
TAG=$4
REPO_URL=${REPO_URL:-https://github.com/hormuz-labs/manul}
rm -rf "$OUT" && mkdir -p "$OUT/pool/$TAG"
cp "$DEBS"/*.deb "$OUT/pool/$TAG/"
cd "$OUT"
for arch in amd64 arm64; do
  mkdir -p "dists/stable/main/binary-$arch"
  apt-ftparchive --arch "$arch" packages pool > "dists/stable/main/binary-$arch/Packages"
  gzip -9fk "dists/stable/main/binary-$arch/Packages"
done
apt-ftparchive \
  -o APT::FTPArchive::Release::Origin="Hormuz Labs" \
  -o APT::FTPArchive::Release::Label="Manul" \
  -o APT::FTPArchive::Release::Suite="stable" \
  -o APT::FTPArchive::Release::Codename="stable" \
  -o APT::FTPArchive::Release::Architectures="amd64 arm64" \
  -o APT::FTPArchive::Release::Components="main" \
  release dists/stable > Release.tmp   # written outside dists/stable so the Release file does not list itself
mv Release.tmp dists/stable/Release
gpg --batch --yes --default-key "$KEY" --clearsign -o dists/stable/InRelease dists/stable/Release
gpg --batch --yes --default-key "$KEY" -abs -o dists/stable/Release.gpg dists/stable/Release
gpg --batch --yes --armor --export "$KEY" > manul.gpg
# the package lists now carry each .deb's size and hashes; the files themselves are served from the release
rm -rf pool
echo "/pool/* $REPO_URL/releases/download/:splat 302" > _redirects
cat > index.html <<EOF
<!doctype html><meta charset="utf-8"><title>Manul apt repository</title>
<body style="font:16px/1.5 system-ui;max-width:46rem;margin:3rem auto;padding:0 1rem">
<h1>Manul apt repository</h1>
<pre style="white-space:pre-wrap">curl -fsSL https://apt.manul.si/manul.gpg | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/manul.gpg &amp;&amp;
echo "deb [signed-by=/usr/share/keyrings/manul.gpg] https://apt.manul.si stable main" | sudo tee /etc/apt/sources.list.d/manul.list &amp;&amp;
sudo apt update &amp;&amp; sudo apt install manul</pre>
<p><a href="$REPO_URL">Manul on GitHub</a></p>
EOF
echo "apt repository for $TAG ready in $OUT"
