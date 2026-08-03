import AppKit
import Carbon.HIToolbox
import CoreGraphics

private let appName = "SnapCut"

private enum CaptureResult {
    case copy
    case save
    case cancel
}

@main
@MainActor
private struct SnapCutMacApp {
    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.accessory)
        application.run()
    }
}

@MainActor
private final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private var captureController: CaptureController?
    private var hotKeyRef: EventHotKeyRef?
    private var hotKeyHandler: EventHandlerRef?

    func applicationDidFinishLaunching(_ notification: Notification) {
        installStatusItem()
        installGlobalHotKey()
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
            self.hotKeyRef = nil
        }
        if let hotKeyHandler {
            RemoveEventHandler(hotKeyHandler)
            self.hotKeyHandler = nil
        }
    }

    private func installStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = NSImage(systemSymbolName: "viewfinder", accessibilityDescription: appName)
        item.button?.toolTip = "\(appName) 截图"

        let menu = NSMenu()
        let capture = NSMenuItem(title: "开始截图", action: #selector(beginCapture), keyEquivalent: "")
        capture.target = self
        menu.addItem(capture)
        menu.addItem(.separator())
        let shortcut = NSMenuItem(title: "快捷键  Control + Command + A", action: nil, keyEquivalent: "")
        shortcut.isEnabled = false
        menu.addItem(shortcut)
        let quit = NSMenuItem(title: "退出 SnapCut", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        item.menu = menu
        statusItem = item
    }

    private func installGlobalHotKey() {
        var eventSpec = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )
        let callback: EventHandlerUPP = { _, event, userData in
            guard let event, let userData else { return noErr }
            let delegate = Unmanaged<AppDelegate>.fromOpaque(userData).takeUnretainedValue()
            var hotKeyID = EventHotKeyID()
            GetEventParameter(
                event,
                EventParamName(kEventParamDirectObject),
                EventParamType(typeEventHotKeyID),
                nil,
                MemoryLayout<EventHotKeyID>.size,
                nil,
                &hotKeyID
            )
            if hotKeyID.id == 1 {
                Task { @MainActor in delegate.beginCapture() }
            }
            return noErr
        }

        let userData = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(
            GetApplicationEventTarget(),
            callback,
            1,
            &eventSpec,
            userData,
            &hotKeyHandler
        )

        let hotKeyID = EventHotKeyID(signature: OSType(0x53434B54), id: 1)
        RegisterEventHotKey(
            UInt32(kVK_ANSI_A),
            UInt32(controlKey | cmdKey),
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )
    }

    @objc private func beginCapture() {
        captureController?.close()
        captureController = CaptureController { [weak self] result, controller in
            self?.finishCapture(result, controller: controller)
        }
        captureController?.begin()
    }

    private func finishCapture(_ result: CaptureResult, controller: CaptureController) {
        defer {
            controller.close()
            if captureController === controller {
                captureController = nil
            }
        }

        guard result != .cancel, let image = controller.croppedImage() else { return }
        guard let pngData = pngData(for: image) else {
            showError("截图导出失败", detail: "无法生成 PNG 图片。")
            return
        }

        if result == .copy {
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setData(pngData, forType: .png)
            return
        }

        let panel = NSSavePanel()
        panel.nameFieldStringValue = "SnapCut-截图.png"
        panel.allowedContentTypes = [.png]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try pngData.write(to: url, options: .atomic)
        } catch {
            showError("保存截图失败", detail: error.localizedDescription)
        }
    }

    private func pngData(for image: CGImage) -> Data? {
        NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
    }

    private func showError(_ title: String, detail: String) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = detail
        alert.runModal()
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}

@MainActor
private final class CaptureController: NSObject {
    private let completion: (CaptureResult, CaptureController) -> Void
    private var panel: NSPanel?
    private var view: CaptureView?
    private var sourceImage: CGImage?
    private var scale: CGFloat = 1

    init(completion: @escaping (CaptureResult, CaptureController) -> Void) {
        self.completion = completion
    }

    func begin() {
        guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else {
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "需要屏幕录制权限"
            alert.informativeText = "请在“系统设置 → 隐私与安全性 → 屏幕录制”中允许 SnapCut，然后重新截图。"
            alert.runModal()
            completion(.cancel, self)
            return
        }

        let mouse = NSEvent.mouseLocation
        guard let screen = NSScreen.screens.first(where: { $0.frame.contains(mouse) }) ?? NSScreen.main else {
            completion(.cancel, self)
            return
        }
        scale = screen.backingScaleFactor
        let displayID: CGDirectDisplayID
        if let screenNumber = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber {
            displayID = CGDirectDisplayID(screenNumber.uint32Value)
        } else {
            displayID = CGMainDisplayID()
        }
        guard let image = CGDisplayCreateImage(displayID) else {
            completion(.cancel, self)
            return
        }
        sourceImage = image

        let captureView = CaptureView(frame: CGRect(origin: .zero, size: screen.frame.size))
        captureView.image = image
        captureView.onResult = { [weak self] result in
            self?.complete(result)
        }
        view = captureView

        let capturePanel = CapturePanel(
            contentRect: screen.frame,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        capturePanel.isOpaque = true
        capturePanel.backgroundColor = .black
        capturePanel.level = .screenSaver
        capturePanel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        capturePanel.hidesOnDeactivate = false
        capturePanel.ignoresMouseEvents = false
        capturePanel.hasShadow = false
        capturePanel.contentView = captureView
        panel = capturePanel

        capturePanel.makeKeyAndOrderFront(nil)
        capturePanel.makeFirstResponder(captureView)
    }

    private func complete(_ result: CaptureResult) {
        completion(result, self)
    }

    func croppedImage() -> CGImage? {
        guard let sourceImage, let selection = view?.selection, selection.width > 1, selection.height > 1 else { return nil }
        let cropRect = CGRect(
            x: selection.minX * scale,
            y: CGFloat(sourceImage.height) - selection.maxY * scale,
            width: selection.width * scale,
            height: selection.height * scale
        ).integral
        return sourceImage.cropping(to: cropRect)
    }

    func close() {
        panel?.orderOut(nil)
        panel?.close()
        panel = nil
        view = nil
        sourceImage = nil
    }
}

@MainActor
private final class CapturePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

@MainActor
private final class CaptureView: NSView {
    var image: CGImage?
    var selection: CGRect?
    var onResult: ((CaptureResult) -> Void)?

    private var dragStart: CGPoint?
    private var toolbar: NSVisualEffectView?

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        context.setFillColor(NSColor.black.cgColor)
        context.fill(bounds)

        if let image {
            let nsImage = NSImage(cgImage: image, size: bounds.size)
            nsImage.draw(in: bounds, from: .zero, operation: .copy, fraction: 1, respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high])
        }

        if let selection {
            context.setFillColor(NSColor.black.withAlphaComponent(0.42).cgColor)
            context.fill(CGRect(x: 0, y: 0, width: bounds.width, height: selection.minY))
            context.fill(CGRect(x: 0, y: selection.maxY, width: bounds.width, height: bounds.height - selection.maxY))
            context.fill(CGRect(x: 0, y: selection.minY, width: selection.minX, height: selection.height))
            context.fill(CGRect(x: selection.maxX, y: selection.minY, width: bounds.width - selection.maxX, height: selection.height))

            context.setStrokeColor(NSColor.systemOrange.cgColor)
            context.setLineWidth(2)
            context.stroke(selection)
        } else {
            let text = "拖动鼠标框选截图区域"
            let attributes: [NSAttributedString.Key: Any] = [
                .font: NSFont.systemFont(ofSize: 15, weight: .medium),
                .foregroundColor: NSColor.white.withAlphaComponent(0.9),
            ]
            let size = text.size(withAttributes: attributes)
            text.draw(at: CGPoint(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2), withAttributes: attributes)
        }
    }

    override func mouseDown(with event: NSEvent) {
        toolbar?.removeFromSuperview()
        toolbar = nil
        dragStart = convert(event.locationInWindow, from: nil)
        selection = CGRect(origin: dragStart ?? .zero, size: .zero)
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        guard let dragStart else { return }
        let current = convert(event.locationInWindow, from: nil)
        selection = CGRect(
            x: min(dragStart.x, current.x),
            y: min(dragStart.y, current.y),
            width: abs(current.x - dragStart.x),
            height: abs(current.y - dragStart.y)
        )
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        defer { dragStart = nil }
        guard let selection, selection.width > 4, selection.height > 4 else {
            self.selection = nil
            needsDisplay = true
            return
        }
        addToolbar(for: selection)
        needsDisplay = true
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 {
            onResult?(.cancel)
        } else if event.keyCode == 36, selection != nil {
            onResult?(.copy)
        } else if event.modifierFlags.contains(.command), event.keyCode == 8, selection != nil {
            onResult?(.copy)
        } else if event.modifierFlags.contains(.command), event.keyCode == 1, selection != nil {
            onResult?(.save)
        } else {
            super.keyDown(with: event)
        }
    }

    private func addToolbar(for selection: CGRect) {
        let barWidth: CGFloat = 246
        let barHeight: CGFloat = 42
        let x = min(max(12, selection.minX), max(12, bounds.width - barWidth - 12))
        let y = selection.maxY + 12 <= bounds.height - barHeight ? selection.maxY + 12 : max(12, selection.minY - barHeight - 12)
        let bar = NSVisualEffectView(frame: CGRect(x: x, y: y, width: barWidth, height: barHeight))
        bar.material = .hudWindow
        bar.state = .active
        bar.wantsLayer = true
        bar.layer?.cornerRadius = 10

        let copy = makeButton("复制", action: #selector(copyCapture))
        copy.frame = CGRect(x: 10, y: 7, width: 66, height: 28)
        let save = makeButton("保存", action: #selector(saveCapture))
        save.frame = CGRect(x: 82, y: 7, width: 66, height: 28)
        let cancel = makeButton("取消", action: #selector(cancelCapture))
        cancel.frame = CGRect(x: 154, y: 7, width: 66, height: 28)
        bar.addSubview(copy)
        bar.addSubview(save)
        bar.addSubview(cancel)
        addSubview(bar)
        toolbar = bar
    }

    private func makeButton(_ title: String, action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.bezelStyle = .texturedRounded
        button.font = NSFont.systemFont(ofSize: 13, weight: .medium)
        return button
    }

    @objc private func copyCapture() { onResult?(.copy) }
    @objc private func saveCapture() { onResult?(.save) }
    @objc private func cancelCapture() { onResult?(.cancel) }
}
