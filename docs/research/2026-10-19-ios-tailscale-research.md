# PowerToDo iOS: embedding Tailscale in-process (research, 2026-10-19)

> Copied from the pre-spike research notes as a record. The spike that checked these claims is
> [2026-10-19-ios-tailnet-spike.md](2026-10-19-ios-tailnet-spike.md); where they differ, the spike report wins.

Scope: an iOS build of PowerToDo (Tauri 2) for the user's own iPhone via TestFlight, embedding Tailscale
in the app process (no Tailscale app, no Network Extension), syncing to the Synology NAS over WebDAV.

Legend: **[V]** = verified (source read, command run, or doc quoted). **[I]** = inference / not verified.

Local experiments were done only in the scratchpad (no repo modified):
`<session scratchpad>/iosbuild/` (a temporary folder outside the repo, not kept)
(a copy of `go.mod`/`go.sum` from `.worktrees/phase4/tailnet`, a tiny tsnet c-archive `main.go`, two clang wrappers).

Environment observed: Go 1.27.2 (`/opt/homebrew/bin/go`; note the shell alias `go` = `git checkout`),
Xcode 27.0 (27A266a) with iPhoneOS27.0 / iPhoneSimulator27.0 SDKs, rustc 1.97.1, only the
`aarch64-apple-darwin` Rust target installed (iOS targets not installed).

---

## 1. libtailscale (github.com/tailscale/libtailscale)

### Official iOS support, Swift package
- **[V]** The repo contains `swift/` with **TailscaleKit**, described in `swift/README.md` as "an embedded network
  interface ... to listen for and dial connections ... in addition to an extension to URLSession". Built with
  `make ios`, `make ios-sim`, `make ios-fat` (xcframework), `make macos` (swift/Makefile lines 28-60).
  "The ios and ios-sim frameworks are purposefully separated. The former ... is suitable for app-store submissions."
  Frameworks are unsigned (README line 35).
- **[V]** It is an Xcode project / framework, **not a SwiftPM package**: no `Package.swift` in the tree; SwiftPM
  support is an open PR (libtailscale#55 "Add SwiftPM and initial linux support for swift", OPEN).
- **[V]** iOS support commits: `40f559c` 2025-03-24 "Makefile/swift: update Makefile and add support for iOS";
  `727bd68` 2025-05-22 "swift: add iOS simulator support". Issue tailscale/tailscale#15410 "libtailscale doesn't
  work on iDevices due to apple sandboxing" (closed) was the `os.Executable()` failure; tsnet now falls back to
  `"tsnet"` on `ios`/`darwin` (`~/go/pkg/mod/tailscale.com@v1.104.1/tsnet/tsnet.go:809-830`).
- **[V]** TailscaleKit's own iOS floor: `TailscaleKit.xcodeproj` sets `IPHONEOS_DEPLOYMENT_TARGET = 18.1`
  (6 occurrences). Commit `8564835` says the code itself can go down to iOS 17 (limited by `ProxyConfiguration`
  in `URLSession+Tailscale`); the Go layer is built with `-mios-version-min=12.0`.
- **[V]** "Officially supported" in the product sense is not stated anywhere; the README has no support statement,
  and the repo has issues disabled (`has_issues: false`), bugs go to tailscale/tailscale.

### Status, releases, Go version
- **[V]** Not archived, BSD-3-Clause, 345 stars, last push 2026-10-14. **No GitHub releases and no tags.**
- **[V]** Recent commits: `d1dc45d` 2026-10-14 "bump binding versions to 0.2.0" (Ruby/Python/sourcepkg only);
  `258321b` 2026-10-13 "frame the listener fd-passing records" (security fix); `019b925` 2026-10-09
  "bump tailscale to v1.104.1"; `80771313` 2026-08-26 "Add tailscale_status_json".
- **[V]** `go.mod`: `go 1.27.1`, `tailscale.com v1.104.1`, `golang.org/x/sys v0.48.0` (same Tailscale version and
  Go directive as our `tailnet/`).
- **[V]** No Rust bindings: PRs #12 "Rust support", #40 "Rust bindings", #47 "Add Rust support" are all CLOSED unmerged.

### C API (tailscale.h, current main)
- **[V]** Lifecycle/config: `tailscale_new()`, `tailscale_start(sd)`, `tailscale_up(sd)` (blocks until usable;
  "To cancel an in-progress call to tailscale_up, use tailscale_close"), `tailscale_close(sd)`,
  `tailscale_set_dir`, `tailscale_set_hostname`, `tailscale_set_authkey`, `tailscale_set_control_url`,
  `tailscale_set_ephemeral`, `tailscale_set_logfd`, `tailscale_errmsg`, `tailscale_getips`.
- **[V]** Networking: `tailscale_dial(sd, network, addr, &conn)` returns a `tailscale_conn` which is an **fd**
  ("a pipe(2) on which you can use read(2), write(2)"); `tailscale_listen` / `tailscale_accept` use a
  socketpair (`syscall.Socketpair(AF_LOCAL, SOCK_STREAM)` in tailscale.go:243, 403) and SCM_RIGHTS fd passing.
- **[V]** **SOCKS5 is exposed**: `tailscale_loopback(sd, addr_out, addrlen, proxy_cred_out, local_api_cred_out)`
  "can be used as a SOCKS5 proxy onto the tailnet. Authentication is required with the username "tsnet" and
  the value of proxy_cred". It also serves LocalAPI on `/localapi` (needs `Sec-Tailscale: localapi` + cred).
  It is a thin wrapper over `tsnet.Server.Loopback()` (tailscale.go:597-640).
- **[V]** `tailscale_status_json(sd, &json)` returns `ipnstate.Status` JSON through tsnet's **in-memory**
  LocalAPI (tailscale.go:650-680).
- **[V] Login URL**: there is **no auth-URL callback** in the C API. Ways to get it:
  (1) `tailscale_status_json` and read `AuthURL` (`ipnstate.Status.AuthURL`, ipnstate.go:48);
  (2) LocalAPI `watch-ipn-bus` over the loopback HTTP server and read `BrowseToURL` (what TailscaleKit's
  README says: "watch the ipn bus ... for the browseToURL field"); (3) parse logs from `tailscale_set_logfd`.

### Linking into a Rust iOS staticlib
- **[V]** libtailscale builds as a Go c-archive (`Makefile` line 38:
  `GOOS=ios GOARCH=arm64 CC=$(PWD)/swift/script/clangwrap-ios.sh go build -v -ldflags -w -tags ios -o $@ -buildmode=c-archive`).
  A c-archive is an ordinary `ar` of Mach-O objects; I built an equivalent one (section 2) and it links with clang.
- **[V]** rustc: for `staticlib` output, `static` native libs default to `+bundle`, meaning "the native static library
  will be packed into the rlib or staticlib archive" (rustc book, linking modifiers). So `cargo:rustc-link-lib=static=...`
  in `build.rs` puts the Go objects inside Tauri's `libapp.a`. Framework deps (`CoreFoundation`, `Security`) must still
  be linked by Xcode (see section 5).
- **[V] Hard constraint: two Go c-archives cannot be linked into one binary.** Test in scratchpad
  (`two/`): linking `liba.a` + `libb.a` gives `duplicate symbol '__cgo_topofstack'` and `duplicate symbol '_crosscall2'`.
  So it is libtailscale **or** our own Go archive, never both (and no other Go-built dependency).

### Known iOS issues (all tailscale/tailscale unless noted)
- **[V] #20060 (OPEN, label OS-ios)**: "On iOS, the OS reclaims that loopback TCP listener when the app process is
  suspended ... the cached loopback address is permanently stale". Root cause is in tsnet: `Server.Loopback()` creates
  the `127.0.0.1:0` listener **once** and caches it in `s.loopbackListener` (tsnet.go:474-496); there is no API to
  recreate it short of `Close()` + new server. The fix (`tailscale_status_json`) only covers status, **not the SOCKS5 proxy.**
  Apple TN2277 confirms the OS behaviour: for a listening socket, "if the system suspends your app and then, later on,
  reclaims the resources ... your app will no longer be listening for connections, even after it has been resumed",
  and advises closing it on background and reopening on foreground.
- **[V] #21167 (OPEN)** "tailscale_close returns success while tailscale_up remains blocked" (fix PR libtailscale#63 OPEN).
- **[V] #21005 (OPEN)** TailscaleKit `down()` calls `tailscale_up()`; there is no `tailscale_down`.
- **[V] #21220 (OPEN)** TailscaleKit `watch-ipn-bus` long poll killed every 60 s (URLSession timeout); fix PR #62 OPEN.
- **[V] #20992 (OPEN)** TailscaleKit.xcframework rejected at App Store upload with ITMS-91053 (missing
  `PrivacyInfo.xcprivacy` in the framework); fix PR libtailscale#57 OPEN. Issue reporter: "Reproduced with a userspace
  tsnet app (no NEPacketTunnelProvider) running on a physical iPhone".
- **[V] #15801 (OPEN)** "HTTPS proxy is also not available on iOS"; `kCFNetworkProxiesSOCKS*` is not available on iOS
  for URLSession. Not relevant to us (reqwest does SOCKS5 itself), but relevant to TailscaleKit's URLSession path.
- **[V] #19050 (closed)** os.Executable failure in frameworks (fixed by the tsnet fallback above).
- **Memory [V/I]**: Tailscale code has iOS memory special cases written for the Network Extension's tight limit
  (`control/controlclient/map.go:225` "Memory is tight on iOS" -> `debug.FreeOSMemory()`; magicsock disables the ring
  buffer on iOS, magicsock.go:2832). [I] A normal foreground app has far more headroom than an NE, so this is unlikely
  to bite, but measure in the spike.
- **State dir [V]**: you must set `Dir` (otherwise it derives one from the executable name). DNS [V]:
  `net/dnscache/dnscache.go:92` disables the Go resolver on darwin/ios (uses the system resolver); MagicDNS name lookup
  for tailnet peers inside tsnet goes through tsnet's own dialer, not the OS.
- **netmon [V]**: `net/netmon/netmon_darwin.go` (applies to `GOOS=ios`, which implies the `darwin` tag) opens an
  `AF_ROUTE` raw socket (`unix.Socket(unix.AF_ROUTE, unix.SOCK_RAW, 0)`). `defaultroute_darwin.go` (`//go:build darwin || ios`)
  prefers a value pushed from Swift via `UpdateLastKnownDefaultRouteInterface` (called by Tailscale's own NE) and
  falls back to BSD routing-table logic. [I] Whether `AF_ROUTE` works in a non-NE app sandbox is not documented; the
  issue reporter above ran a userspace tsnet app on an iPhone, so start-up evidently works. Verify in the spike that
  Wi-Fi <-> cellular changes are detected (otherwise call magicsock rebind on resume / path change).

---

## 2. Our own Go code as an iOS c-archive

### Does it build? (tsnet @ tailscale.com v1.104.1, Go 1.27.2)
- **[V] Yes.** In the scratchpad, with `GOFLAGS=-mod=mod GOPROXY=off GOTOOLCHAIN=local`:
  ```
  CGO_ENABLED=1 GOOS=ios GOARCH=arm64 CC=$PWD/cc-ios.sh go build -trimpath -ldflags=-w -tags ios -buildmode=c-archive -o libtn_ios.a .
  CGO_ENABLED=1 GOOS=ios GOARCH=arm64 CC=$PWD/cc-sim.sh go build -trimpath -ldflags=-w -tags ios -buildmode=c-archive -o libtn_sim.a .
  ```
  Device build 22 s cold, simulator 5 s (warm cache). Both produce `.a` + `.h`.
- **[V]** A copy of the real `tailnet/` (phase4 worktree, stdin/stdout `main`) also compiles for `GOOS=ios GOARCH=arm64`
  unchanged (as an executable, 21.5 MB), so nothing in our code or its deps is iOS-incompatible at compile time.
- **[V] CC wrapper** (same shape as libtailscale `swift/script/clangwrap-ios.sh` and Go's own `$GOROOT/misc/ios/clangwrap.sh`):
  ```sh
  #!/bin/sh
  SDK_PATH=`xcrun --sdk iphoneos --show-sdk-path`
  CLANG=`xcrun --sdk iphoneos --find clang`
  exec "$CLANG" -arch arm64 -isysroot "$SDK_PATH" -mios-version-min=15.0 "$@"
  ```
- **[V] Simulator**: yes, it is `GOOS=ios GOARCH=arm64` with the **iphonesimulator** SDK and
  `-mios-simulator-version-min=...` in the wrapper (libtailscale `clangwrap-ios-sim-arm.sh`, Go `misc/ios/clangwrap.sh`).
  `otool -l` on the extracted objects: device `go.o` = `LC_BUILD_VERSION platform 2` (iOS), simulator `go.o` =
  `platform 7` (iOS Simulator), minos 15.0 in both, so Xcode will accept each slice for its platform.
  `-tags ios` is redundant (GOOS=ios already sets the `ios` and `darwin` tags; Go 1.16 release notes) but harmless.
- **[V] Go 1.27 still supports it**: `go tool dist list` includes `ios/arm64` and `ios/amd64`; build above used go1.27.2.
- **[V] Link requirements**: linking a C `main` against the device archive fails without frameworks; it needs
  `-framework CoreFoundation -framework Security` (undefined `_CF*` and `_SecTrust*`/`_SecCertificate*`/`_SecPolicyCreateSSL`).
  `-lresolv` was not needed.
- **[V] Two Go c-archives cannot coexist** (duplicate `_crosscall2`, `__cgo_topofstack`), see section 1.
- **[V] Size**: `libtn_ios.a` = 25.9 MB on disk; the linked test binary (tsnet + trivial C main) is 21.4 MB, 19.4 MB after
  `strip -x`. The desktop sidecar `powertodo-tailnet-aarch64-apple-darwin` is 20.6 MB. Third-party `tsnet_flutter`
  reports "about 23 MB, or about 14 MB after App Store compression" for the same approach. [I] Expect roughly +19-20 MB
  uncompressed in the app binary; `-ldflags="-s -w"` and `-trimpath` may trim a little more.

---

## 3. tsnet on iOS without a Network Extension

- **[V] Userspace mode**: tsnet always uses netstack (gVisor) in userspace; no TUN, so no NE entitlement is needed for
  the process itself. WireGuard/DERP use ordinary outgoing UDP/TCP sockets, which a normal iOS app may open.
- **[V] Evidence of it running in an iOS app**: tailscale/tailscale#20992 reporter ("userspace tsnet app (no
  NEPacketTunnelProvider) running on a physical iPhone"); #20060 is literally about an embedded node on iOS being
  suspended; TailscaleKit has an iOS example scheme (`HelloFromTailscale iOS`). Third-party `tsnet_flutter`
  (pub.dev) ships the same design: "c-archive (.a in xcframework)", localhost TCP proxy, "no VPN entitlement needed on iOS".
  Tailscale's own iOS app is also Go (the `ipn-go-bridge` referenced in `defaultroute_darwin.go`), but inside an NE.
- **[V] Local Network privacy** (Apple TN3179): "Sending a UDP unicast" to a local-network address requires local
  network access, and the checks "apply to all networking APIs ... BSD Sockets". magicsock will send disco pings to the
  NAS's LAN endpoint (192.168.x.x) and the portmapper probes the router, so iOS will show the Local Network prompt.
  Add `NSLocalNetworkUsageDescription`. If denied, traffic should fall back to the NAS's WAN endpoint or DERP [I].
  `TS_DISABLE_PORTMAPPER` exists (`net/portmapper/portmapper.go:45`) if the router probing is unwanted.
- **Suspend / resume**:
  - **[V]** TN2277: when suspended "no code within the app's process executes", and the system "may choose to reclaim
    resources out from underneath a network socket". Listening sockets: close on background, reopen on foreground.
  - **[V]** Consequence for us: the SOCKS5 listener from `tsnet.Server.Loopback()` can go stale permanently (#20060).
    Our own code can avoid that: run our own `socks5.Server{Dialer: srv.Dial, Username, Password}` (package
    `tailscale.com/net/socks5`, `Server.Serve(ln)`, socks5.go:95-127) on a `net.Listen("tcp","127.0.0.1:0")` that we
    close on `Suspended` and reopen on `Resumed`. `srv.Dial` = `Start` + `awaitRunning` + `s.dialer.UserDial`
    (tsnet.go:373-381), the same dialer Loopback's SOCKS server uses (tsnet.go:521).
  - **[V]** magicsock rebinds UDP sockets on send errors like EPIPE/ENOTCONN (`maybeRebindOnError`, magicsock.go:1610-1624,
    throttled to once per 5 s). [I] After a long suspension the control long-poll and DERP connection will be dead and
    must reconnect; expect a few seconds before the first WebDAV request succeeds. Measure it.
  - **[V]** Tauri exposes lifecycle on mobile: `WindowEvent::Suspended` (iOS `applicationWillResignActive`) and
    `WindowEvent::Resumed` (iOS `applicationWillEnterForeground`), `#[cfg(mobile)]` (tauri-2.12.3 src/app.rs:152-169).
  - **[V]** TN2277 "Background Tasks": begin a background task when a sync starts so a sync in progress finishes after
    the user leaves the app (UIKit `beginBackgroundTask`, needs a few lines of Swift/ObjC; [I] not exposed by Tauri core).
  - **[V]** App Review 2.5.4: background services only "for their intended purposes: VoIP, audio playback, location,
    task completion, local notifications, etc." Finishing a sync = "task completion"; do not try to keep tsnet alive.
- **State directory [V/I]**: Tauri's `app_data_dir()` on iOS = `dirs::data_dir()` + identifier (tauri-2.12.3
  src/path/desktop.rs:251-257), and `dirs` 7.0.0 maps `ios` to `mac.rs`, `data_dir() = app_support_dir()`, i.e.
  `<container>/Library/Application Support/<identifier>`. Use a `tailscale/` subdir there. [I] Mark it
  `isExcludedFromBackup` so a backup restored onto another device does not clone the node key; do not use `Caches`
  (purgeable) or `tmp`. Do not use `Ephemeral` (we want the login to persist).

---

## 4. App Store / TestFlight

- **[V] Guideline 5.4 VPN Apps**: "Apps offering VPN services must utilize the NEVPNManager API and may only be offered by
  developers enrolled as an organization." [I] PowerToDo does not offer a VPN service to the user or the system: it
  is an app that speaks an encrypted protocol to its own back end, the same way any app with its own transport does. I
  found no Apple statement for or against embedding userspace WireGuard, and no confirmed App Review outcome for a
  tsnet/TailscaleKit app. Risk is low for **internal** TestFlight (no review, see next bullet), moderate if ever submitted.
- **[V] Guideline 2.5.2**: no downloading/executing code; a statically linked Go library is fine. [I] Go has shipped in
  App Store apps for years (gomobile, Tailscale's own app).
- **[V] TestFlight review**: App Store Connect Help, TestFlight overview: "If you invite external testers, your beta build may
  require review. When you add the first build of your app to a group, the build gets sent to App Review". The Add internal
  testers page describes up to 100 internal testers, a 90-day test window and "TestFlight Internal Only" builds, and has no
  review step. The developer.apple.com/testflight page ties App Review approval to external groups. So internal testing
  does not go through TestFlight App Review. (Apple pages do not say "no review for internal" in one sentence; this
  follows from the external-only wording.) Builds still pass automated upload validation (e.g. ITMS-91053).
- **[V] Export compliance**: `ITSAppUsesNonExemptEncryption` = `NO` means the app (including linked libraries) "either uses no
  encryption, or only uses encryption that's exempt"; `YES` usually needs `ITSEncryptionExportComplianceCode`. Without the key,
  App Store Connect asks the questionnaire on every upload. Apple: OS-provided HTTPS is "typically" exempt, "whereas the use of
  proprietary encryption is not"; the ASC overview lists "Standard encryption algorithms", "Crypto functionality within Apple's
  operating system", "Proprietary or non-standard" as the cases. [I] We ship standard, published, non-Apple crypto
  (WireGuard: Curve25519/ChaCha20-Poly1305/BLAKE2s; Go crypto/tls; rustls+ring), so answer the ASC questionnaire as
  "standard encryption algorithms instead of, or in addition to, Apple's OS". Do **not** set `NO` blindly; whether
  documentation or a self-classification report is needed is a legal call for the user (EAR); Apple puts liability on the developer.
- **[V/I] Privacy manifest**: the Go runtime imports required-reason APIs: `nm -u` on the linked test binary shows `_stat`,
  `_fstat`, `_fstatat`, `_lstat` (File timestamp category [I]) and `_mach_absolute_time` (System boot time category; Apple's
  mach_absolute_time doc requires a declaration). Add an app-level `PrivacyInfo.xcprivacy` with
  `NSPrivacyAccessedAPITypes` (e.g. reasons C617.1 / 35F9.1 [I: check Apple's current reason list]) or the upload gets
  ITMS-91053 warnings/rejection. Statically linked code is covered by the app's manifest; a separately embedded framework
  (TailscaleKit) needs its own (#20992).

---

## 5. Tauri 2 iOS

### Linking the extra static library
- **[V] How Tauri builds iOS**: the generated Xcode project (xcodegen `project.yml`, template
  `crates/tauri-cli/templates/mobile/ios/project.yml` in tauri-apps/tauri) has a "Build Rust Code" pre-build script that runs
  the Tauri CLI (`xcode-script`), which runs cargo and writes `Externals/<arch>/<config>/libapp.a`; the app target depends on
  `framework: libapp.a` (embed false) and SDK frameworks including `Security.framework`, `UIKit`, `WebKit`, `Metal`, `QuartzCore`,
  `CoreGraphics`, `MetalKit`.
- **[V] Option A, build.rs (recommended)**: `cargo:rustc-link-search=native=<dir>` + `cargo:rustc-link-lib=static=tailnet`.
  For a `staticlib` crate the archive is bundled into `libapp.a` (+bundle default). Pick the slice in build.rs from
  `CARGO_CFG_TARGET_OS == "ios"` and `CARGO_CFG_TARGET_ABI == "sim"` (`rustc --print cfg --target aarch64-apple-ios-sim`
  gives `target_abi="sim"`, `target_env="sim"`; device gives `""`).
- **[V] Frameworks**: `bundle.iOS.frameworks` in tauri.conf: names without extension become `- sdk: <Name>.framework`;
  paths with another extension (e.g. `.xcframework`) become vendor frameworks (`- framework: <path>`)
  (tauri-cli `src/mobile/ios/mod.rs` lines 238-276, `project.rs` line 87; template lines 94-105). So add
  `"frameworks": ["CoreFoundation"]` (Security is already in the template). The `IosConfig` doc says "you need to recreate
  the iOS project for the changes to be applied" (tauri-utils-2.9.3 config.rs:3165-3168). `bundle.iOS.template` allows a
  custom project.yml.
- **[V] Option B, edit `src-tauri/gen/apple/project.yml`** directly: possible (it is regenerated by `tauri ios init`), but config
  or a custom template survives regeneration better. **Gen dir status**: `src-tauri/gen/` currently has only `schemas`
  (no `gen/apple` yet).
- **[V] Tauri docs on native deps**: I found no dedicated docs page on linking native static libs for iOS; the documented knobs
  are the config reference (`bundle.iOS.frameworks`, `template`, `minimumSystemVersion`, `infoPlist`) and Swift mobile plugins
  (v2.tauri.app/develop/plugins/develop-mobile/). Prerequisites: `rustup target add aarch64-apple-ios x86_64-apple-ios
  aarch64-apple-ios-sim`, CocoaPods (v2.tauri.app/start/prerequisites/). Upload: `tauri ios build --export-method
  app-store-connect`, then `xcrun altool --upload-app` with an App Store Connect API key (v2.tauri.app/distribute/app-store/).

### Existing build config that will break on iOS (from the phase4 worktree)
- **[V]** `tauri-build` copies `bundle.externalBin` for **every** target, including iOS (tauri-build-2.7.3 src/lib.rs:735-741), so the
  iOS build would look for `binaries/powertodo-tailnet-aarch64-apple-ios`. Use `src-tauri/tauri.ios.conf.json`
  (supported, tauri-utils parse.rs:58, merged with JSON merge patch, parse.rs:185) to override `bundle.externalBin` and
  `beforeBuildCommand`/`beforeDevCommand` (currently `npm run build:tailnet && ...`).
- **[V]** `src-tauri/src/lib.rs:99` calls `tray::setup(...)` and `lib.rs:8` declares `pub mod tray`; `tauri::tray` exists only with
  `cfg(all(desktop, feature = "tray-icon"))` (tauri-2.12.3 src/lib.rs:121-123), so this needs `#[cfg(desktop)]`.
  `tauri-plugin-single-instance` is already desktop-gated (Cargo.toml target table, lib.rs:77). `lib.rs:68` already has
  `#[cfg_attr(mobile, tauri::mobile_entry_point)]`.

### Plugins (versions from `Cargo.lock`, main checkout and phase4 worktree)
- tauri 2.12.3, tauri-plugin-notification 2.7.0 (Cargo.toml `"2.6"`), tauri-plugin-opener 2.7.1 (`"2"`),
  tauri-plugin-dialog 2.8.2, keyring 4.2.0 + keyring-core 1.0.1 + apple-native-keyring-store 1.0.2 (phase4 only).
  No deep-link plugin in either Cargo.toml.
- **[V] notification 2.7.0**: has `ios/` Swift sources; `NotificationPlugin.swift` implements `show`, `batch`, `cancel`,
  `getPending`, `removeActive`, `requestPermissions`; scheduling builds `UNCalendarNotificationTrigger` /
  `UNTimeIntervalNotificationTrigger` (`Notification.swift:174-213`). Docs table lists ios as supported, plugin needs Rust >= 1.90.
  Scheduled local notifications work on iOS.
- **[V] opener 2.7.1**: `ios/Sources/OpenerPlugin.swift`: `open` uses `UIApplication.shared.open(url)` (Safari / default
  handler), or `SFSafariViewController` when `with == "inAppBrowser"`.
- **[V] deep-link**: Tauri docs: `"plugins": {"deep-link": {"mobile": [{"scheme": ["ovi"], "appLink": false}]}}` "registers the
  `ovi://*` scheme on Android and iOS"; universal links via `appLink: true`. [I] For Google OAuth on iOS, prefer an
  `ASWebAuthenticationSession` style flow or the reversed-client-ID scheme Google issues for iOS clients; check later.
- **[V] keyring 4.2 `v1` does NOT work on iOS**:
  - `v1 = ["apple-native-keyring-store/keychain", ...]` and apple-native-keyring-store has
    `#[cfg(all(target_os = "ios", not(feature = "protected")))] compile_error!("The \`protected\` feature is required on iOS");`
    (apple-native-keyring-store-1.0.2 src/lib.rs:49-50). Since `default = ["v1"]` too, the current
    `keyring = { version = "4.2", features = ["v1"] }` fails to compile for iOS.
  - Even if it compiled, `keyring::v1` store selection returns `Err(... "must be macOS, Windows, or a non-iOS, non-Android *nix variant")`
    on iOS (keyring-4.2.0 src/v1.rs:108-128).
  - Fix: make `keyring` a non-iOS target dependency and on iOS use `keyring-core` + `apple-native-keyring-store` with feature
    `protected` (README: "If you are writing an iOS app, then you have no choice but to use the protected store"; needs a signed app
    with entitlements, else error -34018).
- **[V] notify 8.2.0** (file watcher) uses kqueue on iOS (Cargo.toml target table), so it compiles.

---

## 6. Recommendation

### (a) libtailscale via Rust FFI, or TailscaleKit via Swift
Pros
- Maintained by Tailscale, already bumped to v1.104.1; iOS/simulator build scripts exist; others have run it on iPhones.
- C API is small; `tailscale_status_json` survives suspension; `tailscale_dial` returns a plain fd, and iOS is Unix, so the
  "libtailscale is Unix-only" objection from desktop (Windows) does not apply on iOS.

Cons / risks
- **SOCKS5 loopback goes stale after suspension (#20060)** and tsnet caches the listener: the only recovery with the C API is
  `tailscale_close` + a new server on every resume (`tailscale_close` itself has an open bug with a blocked `tailscale_up`, #21167).
- The alternative that avoids the listener (`tailscale_dial` fds) means writing a custom reqwest/hyper connector, so the
  WebDAV code changes, and only on iOS.
- No auth-URL callback (poll `AuthURL` from status JSON), no `down`, no tags/releases (pin a commit), no Rust bindings, no SwiftPM.
- TailscaleKit (Swift) adds a Swift <-> Rust bridge in a Tauri plugin, an iOS 17/18 floor, its own open bugs (#21005, #21220, #20992
  App Store upload), and its URLSession path cannot be used by our Rust reqwest code.
- Two different Tailscale embeddings to maintain (sidecar on desktop, libtailscale on iOS), and the duplicate-Go-runtime rule
  means we could never also link our own Go code.

### (b) our `tailnet/` Go code as an iOS c-archive (RECOMMENDED)
Pros
- Verified to build today for device and simulator with our exact go.mod (tailscale.com v1.104.1, Go 1.27.2); our code already
  compiles for `GOOS=ios`.
- Same protocol and semantics as desktop: keep `protocol.go` (status/resolve/login URL mapping, already unit-tested), swap only
  the transport (stdin/stdout -> in-memory channel). Rust keeps `socks5h://` + reqwest, so the WebDAV code is unchanged.
- We control the SOCKS5 listener: run `tailscale.com/net/socks5` ourselves with `srv.Dial`, close it on `Suspended`, reopen on
  `Resumed`, and hand Rust a new proxy URL. This avoids #20060, which (a) cannot avoid without restarting the node.
- One Go codebase for desktop sidecar and iOS library (e.g. a shared package plus two thin mains).

Cons / risks
- We own the cgo boundary (memory ownership of returned C strings, thread safety, one server per process).
- We own the iOS build glue (clang wrappers, two slices or an xcframework, build.rs selection, `CoreFoundation` framework).
- Same unknowns as (a) for tsnet itself on iOS: AF_ROUTE netmon in the sandbox, Local Network prompt, reconnect time after resume,
  memory. Neither option removes these.

Suggested C API (mirrors the JSON-lines protocol; no callbacks into Rust from Go threads):
```c
int   tn_start(const char* state_dir, const char* hostname);   // starts tsnet, spawns status loop
int   tn_command(const char* json_line);                       // same Command JSON as stdin today
char* tn_next_event(int timeout_ms);                           // next ReadyMsg/StatusMsg/ResolvedMsg/DoneMsg JSON, or NULL on timeout
int   tn_proxy_open(char* url_out, size_t len);                // (re)listen on 127.0.0.1:0, returns socks5h://user:pass@addr
void  tn_proxy_close(void);                                    // call on Suspended
void  tn_stop(void);
void  tn_free(char*);
```
Rust drives `tn_next_event` from one `spawn_blocking` thread, which replaces the stdout reader of the sidecar.

### Spike: verify first, in this order
1. **Toolchain + compile blockers** (throwaway worktree from origin/main): `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`,
   `tauri ios init`; add `tauri.ios.conf.json` (empty `externalBin`, iOS before-commands); `#[cfg(desktop)]` the tray; iOS keyring
   via `apple-native-keyring-store` `protected`. Goal: blank app runs on the simulator.
2. **Link the Go archive**: build `libtailnet_ios.a` / `libtailnet_sim.a` with the wrapper, link via build.rs
   (`rustc-link-lib=static`), add `bundle.iOS.frameworks: ["CoreFoundation"]`. Goal: call `tn_start` from Rust on the simulator.
3. **Login on a real iPhone**: state dir under Application Support (excluded from backup), get `AuthURL` from status, open it with
   the opener plugin (Safari), come back, reach `Running`. Check the node in the admin console and that it survives an app restart
   without logging in again.
4. **Local Network prompt + path**: add `NSLocalNetworkUsageDescription`; check direct vs DERP to the NAS on home Wi-Fi with
   allow and deny, and on cellular.
5. **WebDAV through SOCKS5**: one PROPFIND + GET/PUT against the NAS with the existing reqwest client.
6. **Suspend/resume**: background for 1 / 10 / 60 min; confirm the old listener is dead (reproduce #20060), then reopen via
   `tn_proxy_open` on `Resumed`; measure time to first successful WebDAV request; switch Wi-Fi <-> cellular while suspended
   (does netmon/AF_ROUTE notice? if not, force a rebind). Add a `beginBackgroundTask` around a sync and check it completes.
7. **Resources**: memory footprint and CPU in Instruments during idle-connected and during a sync; IPA size.
8. **TestFlight internal upload**: app `PrivacyInfo.xcprivacy` (stat family, mach_absolute_time), export-compliance answers, check
   for ITMS warnings, install via TestFlight on the iPhone.

If step 3 or 6 fails because of tsnet on iOS itself (not our glue), (a) would fail the same way, so the fallback is not libtailscale
but a different transport (e.g. QuickConnect/HTTPS to the NAS) or the official Tailscale app.

---

## Sources
- libtailscale repo: https://github.com/tailscale/libtailscale (README.md, tailscale.h, tailscale.go, Makefile, go.mod,
  swift/README.md, swift/Makefile, swift/script/clangwrap-ios*.sh, swift/TailscaleKit.xcodeproj/project.pbxproj); commits
  d1dc45d, 258321b, 019b925, 80771313, 8564835, 61e8513, 40f559c, 727bd68; PRs #55, #57, #62, #63 (open), #12/#40/#47 (closed).
- tailscale/tailscale issues: #20060, #21167, #21005, #21220, #20992, #15801, #15410, #19050.
- Local module source: `~/go/pkg/mod/tailscale.com@v1.104.1/` tsnet/tsnet.go (373-381, 474-541, 805-830), net/socks5/socks5.go (95-127),
  net/netmon/netmon_darwin.go (34-43), net/netmon/defaultroute_darwin.go, net/netmon/netmon_polling.go (build tag), net/dnscache/dnscache.go (90-94),
  control/controlclient/map.go (225-228), wgengine/magicsock/magicsock.go (1610-1624, 2832), net/portmapper/portmapper.go (45),
  ipn/ipnstate/ipnstate.go (48).
- Go: `$GOROOT/misc/ios/README`, `$GOROOT/misc/ios/clangwrap.sh` (go1.27.2); https://go.dev/doc/go1.16#darwin (GOOS=ios implies darwin tag).
- Rust: https://doc.rust-lang.org/rustc/command-line-arguments.html#linking-modifiers-bundle
- Cargo registry: keyring-4.2.0 (Cargo.toml features, src/v1.rs:108-128), apple-native-keyring-store-1.0.2 (src/lib.rs:36-53, README),
  tauri-plugin-notification-2.7.0/ios/Sources, tauri-plugin-opener-2.7.1/ios/Sources/OpenerPlugin.swift, tauri-2.12.3 (src/app.rs:152-169,
  src/lib.rs:121-123, src/path/desktop.rs:251-257), tauri-build-2.7.3 (src/lib.rs:139-168, 735-741, 786-791), tauri-utils-2.9.3
  (src/config.rs:3160-3190, src/config/parse.rs:58,65,185), dirs-7.0.0 (src/lib.rs:23-25, src/mac.rs:12), notify-8.2.0 Cargo.toml.
- Tauri: https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-cli/templates/mobile/ios/project.yml ,
  crates/tauri-cli/src/mobile/ios/mod.rs (238-276), project.rs (87); https://v2.tauri.app/plugin/deep-linking/ ,
  https://v2.tauri.app/plugin/notification/ , https://v2.tauri.app/plugin/opener/ , https://v2.tauri.app/develop/plugins/develop-mobile/ ,
  https://v2.tauri.app/start/prerequisites/ , https://v2.tauri.app/distribute/app-store/
- Apple: https://developer.apple.com/app-store/review/guidelines/ (2.5.2, 2.5.4, 5.4);
  https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/ ;
  https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/ ;
  https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/ ; https://developer.apple.com/testflight/ ;
  https://developer.apple.com/documentation/bundleresources/information-property-list/itsappusesnonexemptencryption ;
  https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations ;
  https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/ ;
  https://developer.apple.com/library/archive/technotes/tn2277/_index.html (TN2277) ;
  https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy (TN3179) ;
  https://developer.apple.com/documentation/driverkit/mach_absolute_time (required-reason declaration).
- Third party: https://pub.dev/packages/tsnet_flutter (same c-archive + localhost proxy design on iOS).
- Local experiments: scratchpad `iosbuild/` (device + simulator c-archive builds, otool platform check, clang link test, nm), `two/`
  (duplicate-runtime link test), `iosbuild/tailnetcopy/` (our tailnet compiled for GOOS=ios).
