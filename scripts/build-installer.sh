#!/bin/bash
set -e

# 确保 cargo-tauri 在 PATH 中
export PATH="$HOME/.cargo/bin:$PATH"

cd "$(dirname "$0")/../src-tauri"
echo "=== Building release binary + NSIS installer ==="
cargo tauri build --bundles nsis
echo "=== Done ==="
echo "Installer: $(dirname "$0")/../src-tauri/target/release/bundle/nsis/Lumina_1.0.0_x64-setup.exe"
