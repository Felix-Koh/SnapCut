#!/bin/zsh
set -euo pipefail

project_dir="$(cd "$(dirname "$0")" && pwd)"
output_dir="${1:-$project_dir/dist}"
version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$project_dir/Info.plist")"
app_dir="$project_dir/build/SnapCut.app"
dmg_path="$output_dir/SnapCut-$version-macos-arm64.dmg"
zip_path="$output_dir/SnapCut-$version-macos-arm64.zip"
stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/snapcut-release.XXXXXX")"

cleanup() {
  rm -rf "$stage_dir"
}
trap cleanup EXIT

"$project_dir/build-app.sh"
mkdir -p "$output_dir"
rm -f "$dmg_path" "$zip_path"

ditto "$app_dir" "$stage_dir/SnapCut.app"
ln -s /Applications "$stage_dir/Applications"

hdiutil create \
  -volname "SnapCut $version" \
  -srcfolder "$stage_dir" \
  -fs HFS+ \
  -ov \
  -format UDZO \
  "$dmg_path" >/dev/null

ditto -c -k --sequesterRsrc --keepParent "$app_dir" "$zip_path"

echo "Packaged $dmg_path"
echo "Packaged $zip_path"
