// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SnapCutMac",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .executable(name: "SnapCutMac", targets: ["SnapCutMac"]),
    ],
    targets: [
        .executableTarget(
            name: "SnapCutMac",
            path: "Sources/SnapCutMac"
        ),
    ]
)
