#!/bin/bash
set -e

# 确保 cargo-tauri 在 PATH 中
export PATH="$HOME/.cargo/bin:$PATH"

cd "$(dirname "$0")/../src-tauri"
# 版本号只有 tauri.conf.json 一处准，别在 echo 里写死（以前这里停在 2.9.3）。
VERSION=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' tauri.conf.json | head -1)
echo "=== Building release binary + NSIS installer (v$VERSION) ==="
cargo tauri build --bundles nsis
echo "=== Done ==="
echo "Installer: $(dirname "$0")/../src-tauri/target/release/bundle/nsis/Lumina_${VERSION}_x64-setup.exe"
