#!/bin/zsh
set -euo pipefail

project_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$project_dir"

swift build --configuration release --product SnapCutMac

app_dir="$project_dir/build/SnapCut.app"
binary_path="$project_dir/.build/arm64-apple-macosx/release/SnapCutMac"
if [[ ! -f "$binary_path" ]]; then
  binary_path="$project_dir/.build/release/SnapCutMac"
fi

rm -rf "$app_dir"
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources"
cp "$binary_path" "$app_dir/Contents/MacOS/SnapCutMac"
cp "$project_dir/Info.plist" "$app_dir/Contents/Info.plist"
chmod +x "$app_dir/Contents/MacOS/SnapCutMac"
codesign --force --deep --sign - "$app_dir" >/dev/null

echo "Built $app_dir"
