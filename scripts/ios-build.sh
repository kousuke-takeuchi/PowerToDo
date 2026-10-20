#!/bin/sh
# Builds the iOS app through xcodebuild while the Tauri CLI serves the build options.
#
#   scripts/ios-build.sh sim <simulator UDID>   debug build for the arm64 simulator, installed and launched
#   scripts/ios-build.sh device                 release build for a device (signed; see below)
#   scripts/ios-build.sh archive                (added with the release task)
#
# Why not `tauri ios build --target aarch64-sim` alone: the Tauri CLI (cargo-mobile2 0.22.5
# `validate_sdk`) refuses to build for the simulator unless a simulator runtime >= the SDK
# version is installed. So the CLI is started with `--open` (it serves the build options to
# Xcode's "Build Rust Code" phase and waits), `open` is stubbed so Xcode does not start, and
# xcodebuild is run against the chosen destination.
#
# The CLI must be native arm64: an x86_64 CLI (node under Rosetta) compiles x86_64-apple-ios for
# the simulator (tauri-cli xcode_script.rs picks the simulator arch from its own target_arch).
# It is taken from $CARGO_TAURI, else ~/.cargo/bin/cargo-tauri.
#
# device: the team comes from XCODE_XCCONFIG_FILE=src-tauri/gen/apple/Signing.xcconfig (git-ignored,
# copy Signing.example.xcconfig), so the team ID never reaches project.yml / project.pbxproj.
set -eu

mode=${1:-}
root=$(cd "$(dirname "$0")/.." && pwd)
work=${TMPDIR:-/tmp}/powertodo-ios
apple=$root/src-tauri/gen/apple

case $mode in
  sim) udid=${2:?usage: ios-build.sh sim <simulator UDID>} ;;
  device) ;;
  archive) echo "archive is not implemented yet" >&2; exit 2 ;;
  *) echo "usage: ios-build.sh sim <UDID> | device | archive" >&2; exit 2 ;;
esac

cli=${CARGO_TAURI:-$HOME/.cargo/bin/cargo-tauri}
[ -x "$cli" ] || { echo "cargo-tauri not found at $cli: install it (arm64) or set CARGO_TAURI" >&2; exit 1; }
case $(file -b "$cli") in
  *arm64*) ;;
  *) echo "$cli is not an arm64 binary (node/cargo under Rosetta?); install an arm64 cargo-tauri or set CARGO_TAURI" >&2; exit 1 ;;
esac

if [ "$mode" = device ]; then
  : "${XCODE_XCCONFIG_FILE:=$apple/Signing.xcconfig}"
  if [ ! -f "$XCODE_XCCONFIG_FILE" ]; then
    echo "$XCODE_XCCONFIG_FILE is missing: copy Signing.example.xcconfig to Signing.xcconfig and write your Team ID in it" >&2
    exit 1
  fi
  export XCODE_XCCONFIG_FILE
fi

mkdir -p "$work/stub"
printf '#!/bin/sh\necho "stub open: $*" >&2\n' > "$work/stub/open"
chmod +x "$work/stub/open"
# cargo-mobile2 wants libimobiledevice (idevicesyslog) on PATH even for the simulator.
if ! command -v idevicesyslog >/dev/null 2>&1; then
  printf '#!/bin/sh\nexit 1\n' > "$work/stub/idevicesyslog"
  chmod +x "$work/stub/idevicesyslog"
fi
# `cargo tauri` runs the arm64 CLI: put its directory first.
PATH="$work/stub:$(dirname "$cli"):$PATH"
export PATH
export TAURI_XCODE_CLI="$cli tauri"

opts=$apple/.tauri/cli-options-server.json
rm -f "$opts"
cd "$root"
if [ "$mode" = sim ]; then
  "$cli" tauri ios build --target aarch64-sim --debug --open --ci > "$work/cli-$mode.log" 2>&1 &
else
  "$cli" tauri ios build --target aarch64 --open --ci > "$work/cli-$mode.log" 2>&1 &
fi
cli_pid=$!
trap 'kill $cli_pid 2>/dev/null; rm -f "$opts"' EXIT
i=0
while [ ! -f "$opts" ]; do
  i=$((i + 1))
  [ $i -gt 300 ] && { echo "the Tauri CLI did not start; see $work/cli-$mode.log" >&2; exit 1; }
  sleep 1
done

if [ "$mode" = sim ]; then
  xcodebuild -project "$apple/powertodo.xcodeproj" -scheme powertodo_iOS \
    -sdk iphonesimulator -configuration debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$work/dd" CODE_SIGNING_ALLOWED=NO build > "$work/xcodebuild-sim.log" 2>&1 \
    || { grep -E 'error:|error\[' "$work/xcodebuild-sim.log" | head -20 >&2; echo "xcodebuild failed; see $work/xcodebuild-sim.log" >&2; exit 1; }
  app=$work/dd/Build/Products/debug-iphonesimulator/PowerToDo.app
  echo "built $app"
  xcrun simctl boot "$udid" 2>/dev/null || true
  xcrun simctl bootstatus "$udid" -b >/dev/null
  xcrun simctl install "$udid" "$app"
  xcrun simctl launch "$udid" app.powertodo
else
  xcodebuild -project "$apple/powertodo.xcodeproj" -scheme powertodo_iOS \
    -sdk iphoneos -configuration release -destination 'generic/platform=iOS' \
    -derivedDataPath "$work/dd-device" -allowProvisioningUpdates build > "$work/xcodebuild-device.log" 2>&1 \
    || { grep -E 'error:|error\[' "$work/xcodebuild-device.log" | head -20 >&2; echo "xcodebuild failed; see $work/xcodebuild-device.log" >&2; exit 1; }
  echo "built $work/dd-device/Build/Products/release-iphoneos/PowerToDo.app"
fi
