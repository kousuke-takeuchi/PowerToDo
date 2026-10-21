#!/bin/sh
# Builds the Go tailnet (tailnet/, build tag ios) as a c-archive for one Rust iOS target.
#
#   scripts/build-tailnet-ios.sh aarch64-apple-ios-sim   # simulator (arm64)
#   scripts/build-tailnet-ios.sh aarch64-apple-ios       # device
#
# Output: src-tauri/binaries/ios/<target>/libtailnet.a (+ libtailnet.h), which
# src-tauri/build.rs links into the app on iOS. src-tauri/binaries/ is git-ignored.
# Go is looked up in this order: $GO, /opt/homebrew/bin/go, then `go` on PATH.
set -eu
target=${1:?rust target: aarch64-apple-ios-sim or aarch64-apple-ios}
root=$(cd "$(dirname "$0")/.." && pwd)
min=16.0 # bundle.iOS.minimumSystemVersion

if [ -n "${GO:-}" ]; then
  go=$GO
elif [ -x /opt/homebrew/bin/go ]; then
  go=/opt/homebrew/bin/go
else
  go=go
fi

case $target in
  aarch64-apple-ios-sim) sdk=iphonesimulator; minflag=-mios-simulator-version-min=$min ;;
  aarch64-apple-ios) sdk=iphoneos; minflag=-mios-version-min=$min ;;
  *) echo "unsupported target $target" >&2; exit 2 ;;
esac

out="$root/src-tauri/binaries/ios/$target"
mkdir -p "$out"
cc="$out/clang-wrapper.sh"
cat > "$cc" <<WRAP
#!/bin/sh
exec "$(xcrun --sdk $sdk --find clang)" -arch arm64 -isysroot "$(xcrun --sdk $sdk --show-sdk-path)" $minflag "\$@"
WRAP
chmod +x "$cc"

cd "$root"
# The package is in tailnet/ (its own module), so build from there.
cd tailnet
CGO_ENABLED=1 GOOS=ios GOARCH=arm64 CC="$cc" \
  "$go" build -trimpath -ldflags=-w -buildmode=c-archive -o "$out/libtailnet.a" .
echo "built $out/libtailnet.a"
