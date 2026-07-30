#!/bin/sh

set -u

DMG_PATH=$1
TARGET_APP=$2
EXPECTED_VERSION=$3
WAIT_PID=$4
UPDATE_TOKEN=$5
LOG_PATH=$6
TARGET_PARENT=$(/usr/bin/dirname "$TARGET_APP")
MOUNT_DIR=$(/usr/bin/mktemp -d "/tmp/SnapCut-Update-Mount.XXXXXX") || exit 1
STAGED_APP="$TARGET_PARENT/.SnapCut.update.$UPDATE_TOKEN"
BACKUP_APP="$TARGET_PARENT/.SnapCut.backup.$UPDATE_TOKEN"
FAILED_APP="$TARGET_PARENT/.SnapCut.failed.$UPDATE_TOKEN"
SOURCE_APP="$MOUNT_DIR/SnapCut.app"
MOUNTED=0

exec >>"$LOG_PATH" 2>&1
echo "SnapCut automatic update started for $EXPECTED_VERSION"

cleanup_mount() {
  if [ "$MOUNTED" -eq 1 ]; then
    /usr/bin/hdiutil detach "$MOUNT_DIR" -quiet || true
    MOUNTED=0
  fi
  /bin/rmdir "$MOUNT_DIR" 2>/dev/null || true
}

remove_staged() {
  if [ -d "$STAGED_APP" ]; then
    /bin/rm -rf -- "$STAGED_APP"
  fi
}

relaunch_existing() {
  if [ -d "$TARGET_APP" ]; then
    /usr/bin/open -n "$TARGET_APP" --args --snapcut-update-failed || true
  fi
}

fail_update() {
  echo "Automatic update failed: $1"
  cleanup_mount
  remove_staged
  if [ -d "$BACKUP_APP" ]; then
    if [ -d "$TARGET_APP" ]; then
      /bin/mv "$TARGET_APP" "$FAILED_APP" 2>/dev/null || true
    fi
    if /bin/mv "$BACKUP_APP" "$TARGET_APP" 2>/dev/null; then
      if [ -d "$FAILED_APP" ]; then
        /bin/rm -rf -- "$FAILED_APP"
      fi
    fi
  fi
  relaunch_existing
  exit 1
}

attempt=0
while /bin/kill -0 "$WAIT_PID" 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 300 ]; then
    fail_update "旧版本未能在 30 秒内退出"
  fi
  /bin/sleep 0.1
done

/usr/bin/hdiutil attach "$DMG_PATH" -nobrowse -readonly -mountpoint "$MOUNT_DIR" -quiet || \
  fail_update "无法挂载 DMG"
MOUNTED=1

[ -d "$SOURCE_APP" ] || fail_update "DMG 中没有 SnapCut.app"
SOURCE_INFO="$SOURCE_APP/Contents/Info.plist"
SOURCE_EXECUTABLE="$SOURCE_APP/Contents/MacOS/SnapCut"
[ -f "$SOURCE_INFO" ] && [ -x "$SOURCE_EXECUTABLE" ] || fail_update "新版应用结构不完整"

BUNDLE_ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$SOURCE_INFO" 2>/dev/null) || \
  fail_update "无法读取新版应用标识"
[ "$BUNDLE_ID" = "com.felixkoh.snapcut" ] || fail_update "新版应用标识不匹配"

ACTUAL_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$SOURCE_INFO" 2>/dev/null) || \
  fail_update "无法读取新版版本号"
[ "$ACTUAL_VERSION" = "$EXPECTED_VERSION" ] || fail_update "新版版本号不匹配"

/usr/bin/file "$SOURCE_EXECUTABLE" | /usr/bin/grep -q 'arm64' || fail_update "新版应用不是 Apple Silicon 版本"

remove_staged
/usr/bin/ditto "$SOURCE_APP" "$STAGED_APP" || fail_update "无法复制新版应用"
[ -x "$STAGED_APP/Contents/MacOS/SnapCut" ] || fail_update "暂存的新版应用不完整"
/usr/bin/xattr -dr com.apple.quarantine "$STAGED_APP" 2>/dev/null || true

if [ -e "$BACKUP_APP" ]; then
  /bin/rm -rf -- "$BACKUP_APP"
fi
/bin/mv "$TARGET_APP" "$BACKUP_APP" || fail_update "无法备份当前版本"
/bin/mv "$STAGED_APP" "$TARGET_APP" || fail_update "无法安装新版本"

cleanup_mount
/usr/bin/open -n "$TARGET_APP" --args --snapcut-update-complete "$EXPECTED_VERSION" || \
  fail_update "无法启动新版本"

/bin/sleep 8
if ! /bin/ps -axo command= | /usr/bin/grep -F "$TARGET_APP/Contents/MacOS/SnapCut" | /usr/bin/grep -v grep >/dev/null; then
  fail_update "新版本启动后意外退出"
fi

/bin/rm -rf -- "$BACKUP_APP"
/bin/rm -f -- "$DMG_PATH"
echo "SnapCut automatic update completed successfully"
/bin/rm -f -- "$0"
/bin/rm -f -- "$LOG_PATH"
exit 0
