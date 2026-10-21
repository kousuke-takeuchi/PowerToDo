// swift-tools-version:5.7

import PackageDescription

let package = Package(
  name: "tauri-plugin-powertodo-ios",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v16),
  ],
  products: [
    .library(
      name: "tauri-plugin-powertodo-ios",
      type: .static,
      targets: ["tauri-plugin-powertodo-ios"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-powertodo-ios",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
