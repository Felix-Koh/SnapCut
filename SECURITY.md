# Security

SnapCut 2.x is a native Swift and AppKit application for Apple Silicon macOS. Screenshots, annotations, clipboard output, saved PNG files, and screen recordings are processed locally.

The application makes a network request only when the user selects “Check for Updates”. That request reads the latest release metadata from this GitHub repository and does not include screenshot content, recordings, telemetry, or device analytics.

Release packages are currently ad-hoc signed and not notarized. Verify downloads against `SHA256SUMS.txt` before applying the README's app-specific quarantine workaround. Never disable Gatekeeper globally.

Electron 1.x is legacy and no longer maintained. Please report security issues in the current native version privately through GitHub's security-advisory feature instead of opening a public issue containing sensitive screenshots or local paths.
