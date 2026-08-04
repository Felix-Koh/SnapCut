#!/bin/zsh
set -euo pipefail

project_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$project_dir"

target_triple="arm64-apple-macosx13.0"
swift build --configuration release --product SnapCutMac --triple "$target_triple"

app_dir="$project_dir/build/SnapCut.app"
binary_path="$project_dir/.build/arm64-apple-macosx/release/SnapCutMac"
icon_path="$project_dir/../../build/icon.icns"
if [[ ! -f "$binary_path" ]]; then
  echo "Expected arm64 release binary was not found: $binary_path" >&2
  exit 1
fi

rm -rf "$app_dir"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
cp "$binary_path" "$app_dir/Contents/MacOS/SnapCut"
cp "$project_dir/Info.plist" "$app_dir/Contents/Info.plist"
cp "$icon_path" "$app_dir/Contents/Resources/icon.icns"
chmod +x "$app_dir/Contents/MacOS/SnapCut"
if [[ "$(lipo -archs "$app_dir/Contents/MacOS/SnapCut")" != "arm64" ]]; then
  echo "Built executable is not arm64-only" >&2
  exit 1
fi
codesign --force --deep --sign - "$app_dir" >/dev/null
codesign --verify --deep --strict "$app_dir"

echo "Built $app_dir"
