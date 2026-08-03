import AppKit
import Carbon.HIToolbox
import CoreGraphics
import Foundation
import UniformTypeIdentifiers

private let appName = "SnapCut"
private let nativeVersion = "0.2.2"
private let showStatusItemKey = "SnapCutShowStatusItem"

private enum CaptureResult {
    case copy
    case save
    case cancel
}

private enum CaptureTool: String, CaseIterable {
    case select
    case rectangle
    case ellipse
    case arrow
    case pen
    case mosaic
    case text

    var symbolName: String {
        switch self {
        case .select: return "cursorarrow"
        case .rectangle: return "rectangle"
        case .ellipse: return "circle"
        case .arrow: return "arrow.up.right"
        case .pen: return "pencil.tip"
        case .mosaic: return "checkerboard.rectangle"
        case .text: return "textformat"
        }
    }

    var fallbackTitle: String {
        switch self {
        case .select: return "选"
        case .rectangle: return "□"
        case .ellipse: return "○"
        case .arrow: return "↗"
        case .pen: return "笔"
        case .mosaic: return "马"
        case .text: return "T"
        }
    }

    var tooltip: String {
        switch self {
        case .select: return "选择和编辑"
        case .rectangle: return "矩形"
        case .ellipse: return "椭圆"
        case .arrow: return "箭头"
        case .pen: return "画笔"
        case .mosaic: return "马赛克"
        case .text: return "文字"
        }
    }
}

private struct DrawingStyle {
    var color: NSColor
    var lineWidth: CGFloat
}

private enum ResizeHandle: CaseIterable {
    case topLeft
    case top
    case topRight
    case right
    case bottomRight
    case bottom
    case bottomLeft
    case left
}

private struct AnnotationGeometry {
    var rect: CGRect
    var startPoint: CGPoint
    var endPoint: CGPoint
    var points: [CGPoint]
    var fontSize: CGFloat
}

private enum CaptureInteraction {
    case idle
    case drawingSelection(start: CGPoint)
    case movingSelection(start: CGPoint, original: CGRect)
    case resizingSelection(handle: ResizeHandle, original: CGRect)
    case creatingAnnotation(item: AnnotationItem, start: CGPoint)
    case drawingBrush(item: AnnotationItem)
    case movingAnnotation(item: AnnotationItem, start: CGPoint, original: AnnotationGeometry)
    case resizingAnnotation(item: AnnotationItem, handle: ResizeHandle, original: AnnotationGeometry)
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
    private var preferencesController: PreferencesController?
    private let updateChecker = NativeUpdateChecker()

    func applicationDidFinishLaunching(_ notification: Notification) {
        if UserDefaults.standard.object(forKey: showStatusItemKey) == nil {
            UserDefaults.standard.set(true, forKey: showStatusItemKey)
        }
        setStatusItemVisible(UserDefaults.standard.bool(forKey: showStatusItemKey))
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

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if statusItem == nil || !flag {
            showPreferences()
        }
        return true
    }

    func setStatusItemVisible(_ visible: Bool) {
        UserDefaults.standard.set(visible, forKey: showStatusItemKey)
        if visible {
            if statusItem == nil {
                installStatusItem()
            }
        } else if let statusItem {
            NSStatusBar.system.removeStatusItem(statusItem)
            self.statusItem = nil
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

        let preferences = NSMenuItem(title: "偏好设置", action: #selector(showPreferences), keyEquivalent: ",")
        preferences.target = self
        menu.addItem(preferences)

        let update = NSMenuItem(title: "检查更新", action: #selector(checkForUpdates), keyEquivalent: "")
        update.target = self
        menu.addItem(update)

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

        guard result != .cancel, let image = controller.renderedCroppedImage() else { return }
        guard let pngData = pngData(for: image) else {
            showError("截图导出失败", detail: "无法生成 PNG 图片。")
            return
        }

        if result == .copy {
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setData(pngData, forType: .png)
            pasteboard.writeObjects([NSImage(cgImage: image, size: .zero)])
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

    @objc private func showPreferences() {
        if preferencesController == nil {
            preferencesController = PreferencesController(appDelegate: self)
        }
        preferencesController?.showWindow(nil)
        preferencesController?.window?.center()
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func checkForUpdates() {
        updateChecker.check()
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}

@MainActor
private final class PreferencesController: NSWindowController {
    private weak var appDelegate: AppDelegate?
    private let statusCheckbox = NSButton(checkboxWithTitle: "显示菜单栏图标", target: nil, action: nil)

    init(appDelegate: AppDelegate) {
        self.appDelegate = appDelegate
        let window = NSWindow(
            contentRect: CGRect(x: 0, y: 0, width: 360, height: 140),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.title = "SnapCut 偏好设置"
        window.isReleasedWhenClosed = false
        super.init(window: window)
        buildContent()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func buildContent() {
        guard let contentView = window?.contentView else { return }
        let title = NSTextField(labelWithString: "基础设置")
        title.font = NSFont.systemFont(ofSize: 15, weight: .semibold)
        title.frame = CGRect(x: 24, y: 92, width: 240, height: 22)
        contentView.addSubview(title)

        statusCheckbox.target = self
        statusCheckbox.action = #selector(toggleStatusItem)
        statusCheckbox.state = UserDefaults.standard.bool(forKey: showStatusItemKey) ? .on : .off
        statusCheckbox.frame = CGRect(x: 24, y: 56, width: 190, height: 24)
        contentView.addSubview(statusCheckbox)

        let hint = NSTextField(labelWithString: "关闭后仍可通过 Control + Command + A 截图。")
        hint.textColor = .secondaryLabelColor
        hint.font = NSFont.systemFont(ofSize: 12)
        hint.frame = CGRect(x: 24, y: 28, width: 300, height: 20)
        contentView.addSubview(hint)
    }

    @objc private func toggleStatusItem() {
        appDelegate?.setStatusItemVisible(statusCheckbox.state == .on)
    }
}

@MainActor
private final class NativeUpdateChecker {
    private let latestReleaseURL = URL(string: "https://api.github.com/repos/Felix-Koh/SnapCut/releases/latest")!

    func check() {
        NSApp.activate(ignoringOtherApps: true)
        URLSession.shared.dataTask(with: latestReleaseURL) { data, _, error in
            Task { @MainActor in
                if let error {
                    self.showUpdateResult(
                        title: "检查更新失败",
                        detail: error.localizedDescription,
                        openURL: nil
                    )
                    return
                }
                guard
                    let data,
                    let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                    let tagName = object["tag_name"] as? String,
                    let htmlURLString = object["html_url"] as? String,
                    let htmlURL = URL(string: htmlURLString)
                else {
                    self.showUpdateResult(
                        title: "检查更新失败",
                        detail: "没有读取到可用的发布信息。",
                        openURL: nil
                    )
                    return
                }

                let detail: String
                if self.isVersion(tagName, newerThan: nativeVersion) {
                    detail = "发现新版本 \(tagName)。原生版自动安装会在正式签名后启用，目前可以先打开发布页下载。"
                } else {
                    detail = "当前原生预览版 \(nativeVersion) 已是最新开发版本。"
                }
                self.showUpdateResult(title: "更新检查完成", detail: detail, openURL: htmlURL)
            }
        }.resume()
    }

    private func showUpdateResult(title: String, detail: String, openURL: URL?) {
        let alert = NSAlert()
        alert.alertStyle = openURL == nil ? .warning : .informational
        alert.messageText = title
        alert.informativeText = detail
        if openURL != nil {
            alert.addButton(withTitle: "打开发布页")
            alert.addButton(withTitle: "稍后")
        } else {
            alert.addButton(withTitle: "好")
        }
        let response = alert.runModal()
        if response == .alertFirstButtonReturn, let openURL {
            NSWorkspace.shared.open(openURL)
        }
    }

    private func isVersion(_ tag: String, newerThan current: String) -> Bool {
        let remote = tag.trimmingCharacters(in: CharacterSet(charactersIn: "vV"))
            .split(separator: ".")
            .compactMap { Int($0.prefix { $0.isNumber }) }
        let local = current.trimmingCharacters(in: CharacterSet(charactersIn: "vV"))
            .split(separator: ".")
            .compactMap { Int($0.prefix { $0.isNumber }) }
        for index in 0..<max(remote.count, local.count) {
            let left = index < remote.count ? remote[index] : 0
            let right = index < local.count ? local[index] : 0
            if left != right {
                return left > right
            }
        }
        return false
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
        captureView.displayScale = scale
        captureView.windowSnapRects = WindowSnapProvider.windowRects(for: displayID, screenSize: screen.frame.size)
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

        NSApp.activate(ignoringOtherApps: true)
        capturePanel.makeKeyAndOrderFront(nil)
        capturePanel.makeFirstResponder(captureView)
    }

    private func complete(_ result: CaptureResult) {
        completion(result, self)
    }

    func renderedCroppedImage() -> CGImage? {
        guard let sourceImage, let view else { return nil }
        return view.renderedCroppedImage(from: sourceImage, scale: scale)
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

private final class WindowSnapProvider {
    static func windowRects(for displayID: CGDirectDisplayID, screenSize: CGSize) -> [CGRect] {
        guard let items = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return []
        }
        let displayBounds = CGDisplayBounds(displayID)
        var rects: [CGRect] = []

        for item in items {
            guard
                let ownerPID = item[kCGWindowOwnerPID as String] as? pid_t,
                ownerPID != ProcessInfo.processInfo.processIdentifier,
                let layer = item[kCGWindowLayer as String] as? Int,
                layer == 0,
                let alpha = item[kCGWindowAlpha as String] as? CGFloat,
                alpha > 0.05,
                let boundsDictionary = item[kCGWindowBounds as String] as? [String: Any],
                let rect = CGRect(dictionaryRepresentation: boundsDictionary as CFDictionary)
            else {
                continue
            }

            let local = CGRect(
                x: rect.minX - displayBounds.minX,
                y: rect.minY - displayBounds.minY,
                width: rect.width,
                height: rect.height
            ).intersection(CGRect(origin: .zero, size: screenSize))

            if local.width >= 80, local.height >= 60 {
                rects.append(local.integral)
            }
        }

        return rects.reduce(into: [CGRect]()) { result, rect in
            if !result.contains(where: { $0.insetBy(dx: -2, dy: -2).contains(rect) }) {
                result.append(rect)
            }
        }
    }
}

private final class AnnotationItem: Equatable {
    var id: UUID
    var kind: CaptureTool
    var rect: CGRect
    var startPoint: CGPoint
    var endPoint: CGPoint
    var points: [CGPoint]
    var text: String
    var color: NSColor
    var lineWidth: CGFloat
    var fontSize: CGFloat

    init(kind: CaptureTool, start: CGPoint, style: DrawingStyle) {
        id = UUID()
        self.kind = kind
        rect = CGRect(origin: start, size: .zero)
        startPoint = start
        endPoint = start
        points = [start]
        text = ""
        color = style.color
        lineWidth = style.lineWidth
        fontSize = max(14, min(48, style.lineWidth * 3.2 + 12))
    }

    private init(
        id: UUID,
        kind: CaptureTool,
        rect: CGRect,
        startPoint: CGPoint,
        endPoint: CGPoint,
        points: [CGPoint],
        text: String,
        color: NSColor,
        lineWidth: CGFloat,
        fontSize: CGFloat
    ) {
        self.id = id
        self.kind = kind
        self.rect = rect
        self.startPoint = startPoint
        self.endPoint = endPoint
        self.points = points
        self.text = text
        self.color = color
        self.lineWidth = lineWidth
        self.fontSize = fontSize
    }

    static func == (lhs: AnnotationItem, rhs: AnnotationItem) -> Bool {
        lhs === rhs || lhs.id == rhs.id
    }

    var bounds: CGRect {
        switch kind {
        case .rectangle, .ellipse, .mosaic, .text:
            return rect.standardized
        case .arrow:
            return CGRect(
                x: min(startPoint.x, endPoint.x),
                y: min(startPoint.y, endPoint.y),
                width: abs(startPoint.x - endPoint.x),
                height: abs(startPoint.y - endPoint.y)
            ).insetBy(dx: -max(8, lineWidth), dy: -max(8, lineWidth)).standardized
        case .pen:
            guard let first = points.first else { return .zero }
            var box = CGRect(origin: first, size: .zero)
            for point in points {
                box = box.union(CGRect(origin: point, size: .zero))
            }
            return box.insetBy(dx: -max(8, lineWidth), dy: -max(8, lineWidth)).standardized
        case .select:
            return .zero
        }
    }

    var isExportable: Bool {
        switch kind {
        case .rectangle, .ellipse, .mosaic:
            return rect.standardized.width > 3 && rect.standardized.height > 3
        case .arrow:
            return distance(startPoint, endPoint) > 4
        case .pen:
            return points.count > 1
        case .text:
            return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .select:
            return false
        }
    }

    var geometry: AnnotationGeometry {
        AnnotationGeometry(rect: rect, startPoint: startPoint, endPoint: endPoint, points: points, fontSize: fontSize)
    }

    func copyItem() -> AnnotationItem {
        AnnotationItem(
            id: id,
            kind: kind,
            rect: rect,
            startPoint: startPoint,
            endPoint: endPoint,
            points: points,
            text: text,
            color: color,
            lineWidth: lineWidth,
            fontSize: fontSize
        )
    }

    func apply(_ geometry: AnnotationGeometry) {
        rect = geometry.rect
        startPoint = geometry.startPoint
        endPoint = geometry.endPoint
        points = geometry.points
        fontSize = geometry.fontSize
    }

    func move(by delta: CGPoint) {
        rect = rect.offsetBy(dx: delta.x, dy: delta.y)
        startPoint = CGPoint(x: startPoint.x + delta.x, y: startPoint.y + delta.y)
        endPoint = CGPoint(x: endPoint.x + delta.x, y: endPoint.y + delta.y)
        points = points.map { CGPoint(x: $0.x + delta.x, y: $0.y + delta.y) }
    }
}

@MainActor
private final class CaptureView: NSView, NSTextFieldDelegate {
    var image: CGImage?
    var displayScale: CGFloat = 1
    var windowSnapRects: [CGRect] = []
    var onResult: ((CaptureResult) -> Void)?

    private(set) var selection: CGRect?
    private var annotations: [AnnotationItem] = []
    private var selectedAnnotation: AnnotationItem?
    private var selectedTool: CaptureTool = .select
    private var styles: [CaptureTool: DrawingStyle] = [
        .select: DrawingStyle(color: .systemOrange, lineWidth: 3),
        .rectangle: DrawingStyle(color: .systemRed, lineWidth: 3),
        .ellipse: DrawingStyle(color: .systemBlue, lineWidth: 3),
        .arrow: DrawingStyle(color: .systemRed, lineWidth: 4),
        .pen: DrawingStyle(color: .systemRed, lineWidth: 4),
        .mosaic: DrawingStyle(color: .systemGray, lineWidth: 14),
        .text: DrawingStyle(color: .systemRed, lineWidth: 4),
    ]

    private var interaction: CaptureInteraction = .idle
    private var hoverWindowRect: CGRect?
    private var currentMouse: CGPoint?
    private var toolbar: NSVisualEffectView?
    private var toolButtons: [CaptureTool: NSButton] = [:]
    private var colorButton: ColorSwatchButton?
    private var colorPicker: ColorPickerPopoverView?
    private var widthSlider: NSSlider?
    private var widthPreview: LineWidthPreviewView?
    private var textEditor: NSTextField?
    private var editingTextItem: AnnotationItem?
    private var textEditingReturnTool: CaptureTool?
    private var isCommittingText = false
    private var styleChangeHistoryCaptured = false
    private var isMagnifierEnabled = true
    private var undoStack: [[AnnotationItem]] = []
    private var redoStack: [[AnnotationItem]] = []

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        for area in trackingAreas {
            removeTrackingArea(area)
        }
        addTrackingArea(
            NSTrackingArea(
                rect: .zero,
                options: [.activeAlways, .inVisibleRect, .mouseMoved, .mouseEnteredAndExited],
                owner: self,
                userInfo: nil
            )
        )
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        drawBackground()
        drawDimmedLayer(context)

        if let selection {
            context.saveGState()
            context.clip(to: selection)
            for item in annotations where item.isExportable || item === editingTextItem {
                drawAnnotation(item, in: context, exportScale: nil, cropOrigin: .zero)
            }
            context.restoreGState()

            drawSelection(selection, in: context)
            drawSizeLabel(for: selection)
        } else if let hoverWindowRect {
            drawHoverWindow(hoverWindowRect, in: context)
        } else {
            drawIntroHint()
        }

        if let selectedAnnotation, selectedTool == .select, textEditor == nil {
            drawAnnotationSelection(selectedAnnotation.bounds, in: context)
        }

        if let currentMouse {
            drawMagnifier(at: currentMouse)
        }
    }

    override func mouseMoved(with event: NSEvent) {
        let point = clamp(convert(event.locationInWindow, from: nil), to: bounds)
        currentMouse = point
        if selection == nil {
            hoverWindowRect = windowSnapRects.first(where: { $0.insetBy(dx: -2, dy: -2).contains(point) })
        }
        needsDisplay = true
    }

    override func mouseExited(with event: NSEvent) {
        currentMouse = nil
        hoverWindowRect = nil
        needsDisplay = true
    }

    override func mouseDown(with event: NSEvent) {
        let point = clamp(convert(event.locationInWindow, from: nil), to: bounds)
        currentMouse = point
        styleChangeHistoryCaptured = false

        if let colorPicker, !colorPicker.frame.contains(point) {
            hideColorPicker()
        }

        if textEditor != nil {
            commitTextEditor()
            needsDisplay = true
            return
        }

        if selection == nil {
            interaction = .drawingSelection(start: point)
            selection = CGRect(origin: point, size: .zero)
            removeToolbar()
            needsDisplay = true
            return
        }

        guard let selection else { return }

        if selectedTool == .select {
            if let selectedAnnotation, let handle = resizeHandle(at: point, for: selectedAnnotation.bounds) {
                pushHistory()
                interaction = .resizingAnnotation(item: selectedAnnotation, handle: handle, original: selectedAnnotation.geometry)
            } else if let item = annotation(at: point) {
                selectedAnnotation = item
                if event.clickCount >= 2, item.kind == .text {
                    pushHistory()
                    startEditingText(item, returnToTool: .select)
                    interaction = .idle
                } else {
                    pushHistory()
                    interaction = .movingAnnotation(item: item, start: point, original: item.geometry)
                }
                syncControlsToCurrentTarget()
            } else if let handle = resizeHandle(at: point, for: selection) {
                selectedAnnotation = nil
                pushHistory()
                interaction = .resizingSelection(handle: handle, original: selection)
            } else if selection.contains(point) {
                selectedAnnotation = nil
                interaction = .movingSelection(start: point, original: selection)
            } else {
                selectedAnnotation = nil
                interaction = .drawingSelection(start: point)
                self.selection = CGRect(origin: point, size: .zero)
                removeToolbar()
            }
            needsDisplay = true
            return
        }

        guard selection.contains(point) else {
            selectedAnnotation = nil
            selectedTool = .select
            syncControlsToCurrentTarget()
            interaction = .drawingSelection(start: point)
            self.selection = CGRect(origin: point, size: .zero)
            removeToolbar()
            needsDisplay = true
            return
        }

        createAnnotation(at: point)
    }

    override func mouseDragged(with event: NSEvent) {
        let point = clamp(convert(event.locationInWindow, from: nil), to: bounds)
        currentMouse = point

        switch interaction {
        case .idle:
            break
        case .drawingSelection(let start):
            let raw = CGRect(
                x: min(start.x, point.x),
                y: min(start.y, point.y),
                width: abs(point.x - start.x),
                height: abs(point.y - start.y)
            )
            selection = snapped(raw.standardized, threshold: 8)
            hoverWindowRect = nil
        case .movingSelection(let start, let original):
            let delta = CGPoint(x: point.x - start.x, y: point.y - start.y)
            selection = clamp(original.offsetBy(dx: delta.x, dy: delta.y), inside: bounds)
            repositionToolbar()
        case .resizingSelection(let handle, let original):
            selection = snapped(resized(original, by: handle, to: point).standardized, threshold: 8)
            repositionToolbar()
        case .creatingAnnotation(let item, let start):
            updateCreatedAnnotation(item, from: start, to: clamp(point, to: selection ?? bounds))
        case .drawingBrush(let item):
            let clipped = clamp(point, to: selection ?? bounds)
            if item.points.last.map({ distance($0, clipped) > 1.5 }) ?? true {
                item.points.append(clipped)
            }
        case .movingAnnotation(let item, let start, let original):
            item.apply(original)
            item.move(by: CGPoint(x: point.x - start.x, y: point.y - start.y))
            clampAnnotation(item, inside: selection)
        case .resizingAnnotation(let item, let handle, let original):
            resizeAnnotation(item, handle: handle, original: original, to: point, inside: selection)
        }

        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        let point = clamp(convert(event.locationInWindow, from: nil), to: bounds)
        currentMouse = point

        switch interaction {
        case .drawingSelection(let start):
            defer { interaction = .idle }
            let clickDistance = distance(start, point)
            if clickDistance < 4, let hoverWindowRect {
                selection = hoverWindowRect
            }
            guard let selection, selection.width > 4, selection.height > 4 else {
                self.selection = nil
                removeToolbar()
                needsDisplay = true
                return
            }
            self.selection = clamp(selection.standardized, inside: bounds)
            selectedAnnotation = nil
            addToolbar()
        case .creatingAnnotation(let item, _), .drawingBrush(let item):
            interaction = .idle
            if !item.isExportable {
                annotations.removeAll { $0 === item }
                selectedAnnotation = nil
                restoreLastHistoryIfNoChange()
            } else {
                selectedAnnotation = nil
                selectedTool = item.kind
                addToolbar()
                syncControlsToCurrentTarget()
            }
        case .movingAnnotation(let item, _, let original):
            interaction = .idle
            if item.geometry == original {
                restoreLastHistoryIfNoChange()
            }
        case .resizingAnnotation(let item, _, let original):
            interaction = .idle
            if item.geometry == original {
                restoreLastHistoryIfNoChange()
            }
        case .movingSelection, .resizingSelection:
            interaction = .idle
            addToolbar()
        case .idle:
            break
        }

        needsDisplay = true
    }

    override func keyDown(with event: NSEvent) {
        if textEditor != nil {
            if event.keyCode == 53 {
                commitTextEditor()
                return
            }
            super.keyDown(with: event)
            return
        }

        if event.keyCode == 53 {
            onResult?(.cancel)
        } else if event.modifierFlags.contains(.command), event.keyCode == 6 {
            if event.modifierFlags.contains(.shift) {
                redo()
            } else {
                undo()
            }
        } else if (event.keyCode == 51 || event.keyCode == 117), let selectedAnnotation {
            pushHistory()
            annotations.removeAll { $0 === selectedAnnotation }
            self.selectedAnnotation = nil
            needsDisplay = true
        } else if moveSelectionOrAnnotation(with: event) {
            return
        } else if selectToolByKeyboard(event) {
            return
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

    func controlTextDidEndEditing(_ obj: Notification) {
        commitTextEditor()
    }

    private func moveSelectionOrAnnotation(with event: NSEvent) -> Bool {
        let step: CGFloat = event.modifierFlags.contains(.shift) ? 10 : 1
        let delta: CGPoint
        switch event.keyCode {
        case 123:
            delta = CGPoint(x: -step, y: 0)
        case 124:
            delta = CGPoint(x: step, y: 0)
        case 125:
            delta = CGPoint(x: 0, y: step)
        case 126:
            delta = CGPoint(x: 0, y: -step)
        default:
            return false
        }

        if let selectedAnnotation {
            pushHistory()
            selectedAnnotation.move(by: delta)
            clampAnnotation(selectedAnnotation, inside: selection)
        } else if let selection {
            pushHistory()
            self.selection = clamp(selection.offsetBy(dx: delta.x, dy: delta.y), inside: bounds)
            repositionToolbar()
        } else {
            return false
        }
        needsDisplay = true
        return true
    }

    private func selectToolByKeyboard(_ event: NSEvent) -> Bool {
        guard
            !event.modifierFlags.contains(.command),
            !event.modifierFlags.contains(.control),
            let key = event.charactersIgnoringModifiers?.lowercased()
        else {
            return false
        }

        let tool: CaptureTool?
        switch key {
        case "v":
            tool = .select
        case "r":
            tool = .rectangle
        case "o":
            tool = .ellipse
        case "a":
            tool = .arrow
        case "p":
            tool = .pen
        case "b":
            tool = .mosaic
        case "t":
            tool = .text
        case "m":
            isMagnifierEnabled.toggle()
            needsDisplay = true
            return true
        default:
            tool = nil
        }

        guard let tool else { return false }
        selectedTool = tool
        selectedAnnotation = nil
        styleChangeHistoryCaptured = false
        syncControlsToCurrentTarget()
        needsDisplay = true
        return true
    }

    func renderedCroppedImage(from sourceImage: CGImage, scale: CGFloat) -> CGImage? {
        commitTextEditor()
        guard let selection, selection.width > 1, selection.height > 1 else { return nil }
        let pixelWidth = max(1, Int((selection.width * scale).rounded()))
        let pixelHeight = max(1, Int((selection.height * scale).rounded()))
        let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        guard
            let context = CGContext(
                data: nil,
                width: pixelWidth,
                height: pixelHeight,
                bitsPerComponent: 8,
                bytesPerRow: 0,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            )
        else {
            return nil
        }

        let cropRect = CGRect(
            x: selection.minX * scale,
            y: CGFloat(sourceImage.height) - selection.maxY * scale,
            width: selection.width * scale,
            height: selection.height * scale
        ).integral
        guard let cropped = sourceImage.cropping(to: cropRect) else { return nil }

        context.interpolationQuality = .high
        context.draw(cropped, in: CGRect(x: 0, y: 0, width: pixelWidth, height: pixelHeight))

        context.saveGState()
        context.translateBy(x: 0, y: CGFloat(pixelHeight))
        context.scaleBy(x: scale, y: -scale)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: true)
        for item in annotations where item.isExportable && item.bounds.intersects(selection) {
            drawAnnotation(item, in: context, exportScale: scale, cropOrigin: selection.origin)
        }
        NSGraphicsContext.restoreGraphicsState()
        context.restoreGState()

        return context.makeImage()
    }

    private func createAnnotation(at point: CGPoint) {
        let style = styles[selectedTool] ?? DrawingStyle(color: .systemRed, lineWidth: 3)
        let item = AnnotationItem(kind: selectedTool, start: point, style: style)
        pushHistory()
        annotations.append(item)
        selectedAnnotation = item

        if selectedTool == .text {
            item.rect = CGRect(x: point.x, y: point.y, width: 180, height: max(28, item.fontSize + 10))
            startEditingText(item, returnToTool: .text)
            interaction = .idle
        } else if selectedTool == .pen {
            interaction = .drawingBrush(item: item)
        } else {
            interaction = .creatingAnnotation(item: item, start: point)
        }

        needsDisplay = true
    }

    private func updateCreatedAnnotation(_ item: AnnotationItem, from start: CGPoint, to point: CGPoint) {
        switch item.kind {
        case .rectangle, .ellipse, .mosaic, .text:
            item.rect = CGRect(
                x: min(start.x, point.x),
                y: min(start.y, point.y),
                width: abs(point.x - start.x),
                height: abs(point.y - start.y)
            ).standardized
        case .arrow:
            item.startPoint = start
            item.endPoint = point
        case .pen:
            item.points.append(point)
        case .select:
            break
        }
    }

    private func drawBackground() {
        NSColor.black.setFill()
        bounds.fill()
        if let image {
            let nsImage = NSImage(cgImage: image, size: bounds.size)
            nsImage.draw(
                in: bounds,
                from: .zero,
                operation: .copy,
                fraction: 1,
                respectFlipped: true,
                hints: [.interpolation: NSImageInterpolation.high]
            )
        }
    }

    private func drawDimmedLayer(_ context: CGContext) {
        guard let selection else {
            context.setFillColor(NSColor.black.withAlphaComponent(0.34).cgColor)
            context.fill(bounds)
            return
        }

        context.setFillColor(NSColor.black.withAlphaComponent(0.42).cgColor)
        context.fill(CGRect(x: 0, y: 0, width: bounds.width, height: selection.minY))
        context.fill(CGRect(x: 0, y: selection.maxY, width: bounds.width, height: bounds.height - selection.maxY))
        context.fill(CGRect(x: 0, y: selection.minY, width: selection.minX, height: selection.height))
        context.fill(CGRect(x: selection.maxX, y: selection.minY, width: bounds.width - selection.maxX, height: selection.height))
    }

    private func drawIntroHint() {
        let text = "拖动框选，或点击窗口自动吸附"
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 15, weight: .medium),
            .foregroundColor: NSColor.white.withAlphaComponent(0.9),
        ]
        let size = text.size(withAttributes: attributes)
        text.draw(
            at: CGPoint(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2),
            withAttributes: attributes
        )
    }

    private func drawHoverWindow(_ rect: CGRect, in context: CGContext) {
        context.saveGState()
        context.setFillColor(NSColor.systemOrange.withAlphaComponent(0.12).cgColor)
        context.fill(rect)
        context.setStrokeColor(NSColor.systemOrange.cgColor)
        context.setLineWidth(3)
        context.stroke(rect.insetBy(dx: 1.5, dy: 1.5))
        context.restoreGState()
    }

    private func drawSelection(_ rect: CGRect, in context: CGContext) {
        context.saveGState()
        context.setStrokeColor(NSColor.systemOrange.cgColor)
        context.setLineWidth(2)
        context.stroke(rect.insetBy(dx: 1, dy: 1))
        if selectedTool == .select {
            drawHandles(for: rect, in: context)
        }
        context.restoreGState()
    }

    private func drawSizeLabel(for rect: CGRect) {
        let text = "\(Int(rect.width * displayScale)) × \(Int(rect.height * displayScale))"
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .medium),
            .foregroundColor: NSColor.white,
            .backgroundColor: NSColor.black.withAlphaComponent(0.58),
        ]
        let size = text.size(withAttributes: attributes)
        let labelRect = CGRect(
            x: min(max(8, rect.minX), bounds.width - size.width - 16),
            y: max(8, rect.minY - size.height - 8),
            width: size.width + 12,
            height: size.height + 6
        )
        NSColor.black.withAlphaComponent(0.58).setFill()
        NSBezierPath(roundedRect: labelRect, xRadius: 5, yRadius: 5).fill()
        text.draw(at: CGPoint(x: labelRect.minX + 6, y: labelRect.minY + 3), withAttributes: attributes)
    }

    private func drawAnnotationSelection(_ rect: CGRect, in context: CGContext) {
        guard !rect.isNull, rect.width.isFinite, rect.height.isFinite else { return }
        context.saveGState()
        context.setStrokeColor(NSColor.white.withAlphaComponent(0.95).cgColor)
        context.setLineWidth(1)
        context.setLineDash(phase: 0, lengths: [4, 4])
        context.stroke(rect.insetBy(dx: -3, dy: -3))
        context.setLineDash(phase: 0, lengths: [])
        drawHandles(for: rect, in: context)
        context.restoreGState()
    }

    private func drawHandles(for rect: CGRect, in context: CGContext) {
        for (_, handleRect) in handleRects(for: rect) {
            context.setFillColor(NSColor.white.cgColor)
            context.fill(handleRect)
            context.setStrokeColor(NSColor.systemOrange.cgColor)
            context.setLineWidth(1)
            context.stroke(handleRect)
        }
    }

    private func drawAnnotation(_ item: AnnotationItem, in context: CGContext, exportScale: CGFloat?, cropOrigin: CGPoint) {
        context.saveGState()
        if cropOrigin != .zero {
            context.translateBy(x: -cropOrigin.x, y: -cropOrigin.y)
        }
        context.setStrokeColor(item.color.cgColor)
        context.setFillColor(item.color.cgColor)
        context.setLineWidth(item.lineWidth)
        context.setLineCap(.round)
        context.setLineJoin(.round)

        switch item.kind {
        case .rectangle:
            context.stroke(item.rect.standardized)
        case .ellipse:
            context.strokeEllipse(in: item.rect.standardized)
        case .arrow:
            drawArrow(from: item.startPoint, to: item.endPoint, width: item.lineWidth, color: item.color, in: context)
        case .pen:
            drawPolyline(item.points, in: context)
        case .mosaic:
            drawMosaic(item.rect.standardized, in: context, exportScale: exportScale, cropOrigin: cropOrigin)
        case .text:
            drawText(item, in: context)
        case .select:
            break
        }

        context.restoreGState()
    }

    private func drawPolyline(_ points: [CGPoint], in context: CGContext) {
        guard points.count > 1, let first = points.first else { return }
        context.beginPath()
        context.move(to: first)
        for point in points.dropFirst() {
            context.addLine(to: point)
        }
        context.strokePath()
    }

    private func drawArrow(from start: CGPoint, to end: CGPoint, width: CGFloat, color: NSColor, in context: CGContext) {
        let length = distance(start, end)
        guard length > 1 else { return }
        context.beginPath()
        context.move(to: start)
        context.addLine(to: end)
        context.strokePath()

        let angle = atan2(end.y - start.y, end.x - start.x)
        let headLength = max(12, width * 4.2)
        let spread = CGFloat.pi / 7
        let pointA = CGPoint(
            x: end.x - cos(angle - spread) * headLength,
            y: end.y - sin(angle - spread) * headLength
        )
        let pointB = CGPoint(
            x: end.x - cos(angle + spread) * headLength,
            y: end.y - sin(angle + spread) * headLength
        )

        context.beginPath()
        context.move(to: end)
        context.addLine(to: pointA)
        context.move(to: end)
        context.addLine(to: pointB)
        context.strokePath()
    }

    private func drawText(_ item: AnnotationItem, in context: CGContext) {
        guard !item.text.isEmpty else { return }
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byWordWrapping
        let attributes: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: item.fontSize, weight: .semibold),
            .foregroundColor: item.color,
            .paragraphStyle: paragraph,
        ]
        let textRect = item.rect.standardized.insetBy(dx: 2, dy: 1)
        NSString(string: item.text).draw(with: textRect, options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: attributes)
    }

    private func drawMosaic(_ rect: CGRect, in context: CGContext, exportScale: CGFloat?, cropOrigin: CGPoint) {
        let scale = exportScale ?? displayScale
        guard
            let image,
            rect.width > 2,
            rect.height > 2
        else {
            context.setFillColor(NSColor.systemGray.withAlphaComponent(0.55).cgColor)
            context.fill(rect)
            return
        }

        let sourceRect = CGRect(
            x: rect.minX * scale,
            y: CGFloat(image.height) - rect.maxY * scale,
            width: rect.width * scale,
            height: rect.height * scale
        ).integral
        guard let crop = image.cropping(to: sourceRect) else {
            context.setFillColor(NSColor.systemGray.withAlphaComponent(0.55).cgColor)
            context.fill(rect)
            return
        }

        let blockSize = max(6, min(22, rect.width / 8, rect.height / 8, (exportScale ?? 1) * 10))
        let tinyWidth = max(1, Int((rect.width * scale / blockSize).rounded()))
        let tinyHeight = max(1, Int((rect.height * scale / blockSize).rounded()))
        let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        guard
            let smallContext = CGContext(
                data: nil,
                width: tinyWidth,
                height: tinyHeight,
                bitsPerComponent: 8,
                bytesPerRow: 0,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            )
        else {
            return
        }
        smallContext.interpolationQuality = .low
        smallContext.draw(crop, in: CGRect(x: 0, y: 0, width: tinyWidth, height: tinyHeight))
        guard let smallImage = smallContext.makeImage() else { return }

        context.saveGState()
        context.interpolationQuality = .none
        context.draw(smallImage, in: rect)
        context.restoreGState()
    }

    private func drawMagnifier(at point: CGPoint) {
        guard isMagnifierEnabled else { return }
        guard selection == nil || interaction.isDrawingSelection else { return }
        guard let image else { return }
        let lensSize: CGFloat = 112
        let sourceSize: CGFloat = 18
        let x = point.x + lensSize + 20 < bounds.width ? point.x + 18 : point.x - lensSize - 18
        let y = point.y + lensSize + 20 < bounds.height ? point.y + 18 : point.y - lensSize - 18
        let lensRect = CGRect(x: max(10, x), y: max(10, y), width: lensSize, height: lensSize)
        let cropRect = CGRect(
            x: (point.x - sourceSize / 2) * displayScale,
            y: CGFloat(image.height) - (point.y + sourceSize / 2) * displayScale,
            width: sourceSize * displayScale,
            height: sourceSize * displayScale
        ).integral
        guard let crop = image.cropping(to: cropRect) else { return }

        NSGraphicsContext.current?.cgContext.saveGState()
        NSColor.black.withAlphaComponent(0.76).setFill()
        NSBezierPath(roundedRect: lensRect.insetBy(dx: -3, dy: -3), xRadius: 8, yRadius: 8).fill()
        let nsImage = NSImage(cgImage: crop, size: lensRect.size)
        nsImage.draw(
            in: lensRect,
            from: .zero,
            operation: .copy,
            fraction: 1,
            respectFlipped: true,
            hints: [.interpolation: NSImageInterpolation.none]
        )
        NSColor.systemOrange.setStroke()
        let border = NSBezierPath(roundedRect: lensRect, xRadius: 6, yRadius: 6)
        border.lineWidth = 2
        border.stroke()

        NSColor.white.withAlphaComponent(0.9).setStroke()
        let cross = NSBezierPath()
        cross.move(to: CGPoint(x: lensRect.midX, y: lensRect.minY))
        cross.line(to: CGPoint(x: lensRect.midX, y: lensRect.maxY))
        cross.move(to: CGPoint(x: lensRect.minX, y: lensRect.midY))
        cross.line(to: CGPoint(x: lensRect.maxX, y: lensRect.midY))
        cross.lineWidth = 1
        cross.stroke()
        NSGraphicsContext.current?.cgContext.restoreGState()
    }

    private func addToolbar() {
        guard let selection else { return }
        if toolbar == nil {
            buildToolbar()
        }
        repositionToolbar(for: selection)
        syncControlsToCurrentTarget()
    }

    private func buildToolbar() {
        let bar = NSVisualEffectView(frame: CGRect(x: 0, y: 0, width: 626, height: 48))
        bar.material = .hudWindow
        bar.state = .active
        bar.wantsLayer = true
        bar.layer?.cornerRadius = 10
        bar.layer?.masksToBounds = true

        var x: CGFloat = 9
        for tool in CaptureTool.allCases {
            let button = makeIconButton(symbolName: tool.symbolName, fallbackTitle: tool.fallbackTitle, action: #selector(selectTool(_:)))
            button.identifier = NSUserInterfaceItemIdentifier(tool.rawValue)
            button.toolTip = tool.tooltip
            button.setButtonType(.toggle)
            button.frame = CGRect(x: x, y: 9, width: 30, height: 30)
            bar.addSubview(button)
            toolButtons[tool] = button
            x += 34
        }

        x += 6
        let separatorA = makeSeparator(x: x)
        bar.addSubview(separatorA)
        x += 10

        let swatch = ColorSwatchButton(frame: CGRect(x: x, y: 9, width: 44, height: 30))
        swatch.target = self
        swatch.action = #selector(toggleColorPicker(_:))
        swatch.toolTip = "颜色"
        bar.addSubview(swatch)
        colorButton = swatch
        x += 54

        let slider = NSSlider(value: 4, minValue: 1, maxValue: 18, target: self, action: #selector(widthChanged(_:)))
        slider.isContinuous = true
        slider.frame = CGRect(x: x, y: 12, width: 96, height: 24)
        slider.toolTip = "粗细或字号"
        bar.addSubview(slider)
        widthSlider = slider
        x += 104

        let preview = LineWidthPreviewView(frame: CGRect(x: x, y: 9, width: 46, height: 30))
        bar.addSubview(preview)
        widthPreview = preview
        x += 54

        let separatorB = makeSeparator(x: x)
        bar.addSubview(separatorB)
        x += 10

        let undo = makeIconButton(symbolName: "arrow.uturn.backward", fallbackTitle: "↶", action: #selector(undoButton))
        undo.toolTip = "撤销"
        undo.frame = CGRect(x: x, y: 9, width: 30, height: 30)
        bar.addSubview(undo)
        x += 34

        let redo = makeIconButton(symbolName: "arrow.uturn.forward", fallbackTitle: "↷", action: #selector(redoButton))
        redo.toolTip = "重做"
        redo.frame = CGRect(x: x, y: 9, width: 30, height: 30)
        bar.addSubview(redo)
        x += 40

        let separatorC = makeSeparator(x: x)
        bar.addSubview(separatorC)
        x += 10

        let copy = makeIconButton(symbolName: "doc.on.doc", fallbackTitle: "复制", action: #selector(copyCapture))
        copy.toolTip = "复制"
        copy.frame = CGRect(x: x, y: 9, width: 38, height: 30)
        bar.addSubview(copy)
        x += 42

        let save = makeIconButton(symbolName: "square.and.arrow.down", fallbackTitle: "保存", action: #selector(saveCapture))
        save.toolTip = "保存"
        save.frame = CGRect(x: x, y: 9, width: 38, height: 30)
        bar.addSubview(save)
        x += 42

        let cancel = makeIconButton(symbolName: "xmark", fallbackTitle: "取消", action: #selector(cancelCapture))
        cancel.toolTip = "取消"
        cancel.frame = CGRect(x: x, y: 9, width: 38, height: 30)
        bar.addSubview(cancel)
        x += 47

        bar.frame.size.width = x
        addSubview(bar)
        toolbar = bar
    }

    private func repositionToolbar() {
        guard let selection else { return }
        repositionToolbar(for: selection)
    }

    private func repositionToolbar(for selection: CGRect) {
        guard let toolbar else { return }
        let margin: CGFloat = 12
        let barWidth = toolbar.frame.width
        let barHeight = toolbar.frame.height
        let x = min(max(margin, selection.minX), max(margin, bounds.width - barWidth - margin))
        let y = selection.maxY + margin <= bounds.height - barHeight ? selection.maxY + margin : max(margin, selection.minY - barHeight - margin)
        toolbar.frame.origin = CGPoint(x: x, y: y)
    }

    private func removeToolbar() {
        hideColorPicker()
        toolbar?.removeFromSuperview()
        toolbar = nil
        toolButtons.removeAll()
        colorButton = nil
        widthSlider = nil
        widthPreview = nil
    }

    private func makeSeparator(x: CGFloat) -> NSView {
        let separator = NSView(frame: CGRect(x: x, y: 9, width: 1, height: 30))
        separator.wantsLayer = true
        separator.layer?.backgroundColor = NSColor.white.withAlphaComponent(0.16).cgColor
        return separator
    }

    private func makeIconButton(symbolName: String, fallbackTitle: String, action: Selector) -> NSButton {
        let button: NSButton
        if let image = NSImage(systemSymbolName: symbolName, accessibilityDescription: fallbackTitle) {
            button = NSButton(image: image, target: self, action: action)
            button.imageScaling = .scaleProportionallyDown
        } else {
            button = NSButton(title: fallbackTitle, target: self, action: action)
            button.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        }
        button.bezelStyle = .texturedRounded
        button.isBordered = true
        button.focusRingType = .none
        return button
    }

    @objc private func selectTool(_ sender: NSButton) {
        guard
            let rawValue = sender.identifier?.rawValue,
            let tool = CaptureTool(rawValue: rawValue)
        else {
            return
        }
        commitTextEditor()
        styleChangeHistoryCaptured = false
        selectedTool = tool
        if tool != .select {
            selectedAnnotation = nil
        }
        syncControlsToCurrentTarget()
        window?.makeFirstResponder(self)
        needsDisplay = true
    }

    @objc private func toggleColorPicker(_ sender: NSButton) {
        guard let sender = sender as? ColorSwatchButton else { return }
        if colorPicker != nil {
            hideColorPicker()
        } else {
            showColorPicker(anchor: sender)
        }
        window?.makeFirstResponder(self)
    }

    private func showColorPicker(anchor: ColorSwatchButton) {
        hideColorPicker()
        styleChangeHistoryCaptured = false
        let picker = ColorPickerPopoverView(color: currentStyle().color)
        picker.onColorChanged = { [weak self] color in
            self?.applyColor(color)
        }
        picker.frame.origin = colorPickerOrigin(for: picker.frame.size, anchor: anchor)
        addSubview(picker, positioned: .above, relativeTo: toolbar)
        colorPicker = picker
    }

    private func hideColorPicker() {
        colorPicker?.removeFromSuperview()
        colorPicker = nil
    }

    private func colorPickerOrigin(for pickerSize: CGSize, anchor: NSView) -> CGPoint {
        guard let toolbar else {
            return CGPoint(x: 12, y: 12)
        }
        let anchorRect = toolbar.convert(anchor.frame, to: self)
        let margin: CGFloat = 12
        let x = min(max(margin, anchorRect.midX - pickerSize.width / 2), max(margin, bounds.width - pickerSize.width - margin))
        var y = toolbar.frame.minY - pickerSize.height - 10
        if y < margin {
            y = toolbar.frame.maxY + 10
        }
        if y + pickerSize.height > bounds.height - margin {
            y = bounds.height - pickerSize.height - margin
        }
        return CGPoint(x: x, y: max(margin, y))
    }

    private func applyColor(_ color: NSColor) {
        pushHistoryIfEditingStyle()
        let normalizedColor = color.usingColorSpace(.deviceRGB) ?? color
        if let selectedAnnotation {
            selectedAnnotation.color = normalizedColor
            styles[selectedAnnotation.kind]?.color = normalizedColor
            if selectedAnnotation === editingTextItem {
                textEditor?.textColor = normalizedColor
            }
        } else if selectedTool != .select {
            styles[selectedTool]?.color = normalizedColor
        }
        colorButton?.color = normalizedColor
        widthPreview?.color = normalizedColor
        needsDisplay = true
    }

    @objc private func widthChanged(_ sender: NSSlider) {
        pushHistoryIfEditingStyle()
        let value = CGFloat(sender.doubleValue)
        if let selectedAnnotation {
            if selectedAnnotation.kind == .text {
                selectedAnnotation.fontSize = max(12, min(72, value * 3.2 + 10))
            } else {
                selectedAnnotation.lineWidth = value
            }
            styles[selectedAnnotation.kind]?.lineWidth = value
        } else if selectedTool != .select {
            styles[selectedTool]?.lineWidth = value
        }
        widthPreview?.lineWidth = value
        needsDisplay = true
    }

    private func pushHistoryIfEditingStyle() {
        if selectedAnnotation != nil, !styleChangeHistoryCaptured {
            pushHistory()
            styleChangeHistoryCaptured = true
        }
    }

    private func syncControlsToCurrentTarget() {
        for (tool, button) in toolButtons {
            button.state = tool == selectedTool ? .on : .off
        }

        let style = currentStyle()

        colorButton?.color = style.color
        colorPicker?.setColor(style.color, notify: false)
        widthSlider?.doubleValue = Double(style.lineWidth)
        widthPreview?.color = style.color
        widthPreview?.lineWidth = style.lineWidth
        widthPreview?.needsDisplay = true
    }

    private func currentStyle() -> DrawingStyle {
        let targetTool = selectedAnnotation?.kind ?? selectedTool
        return selectedAnnotation.map {
            DrawingStyle(color: $0.color, lineWidth: $0.kind == .text ? max(1, min(18, ($0.fontSize - 10) / 3.2)) : $0.lineWidth)
        } ?? styles[targetTool] ?? DrawingStyle(color: .systemRed, lineWidth: 3)
    }

    @objc private func undoButton() { undo() }
    @objc private func redoButton() { redo() }
    @objc private func copyCapture() {
        commitTextEditor()
        onResult?(.copy)
    }
    @objc private func saveCapture() {
        commitTextEditor()
        onResult?(.save)
    }
    @objc private func cancelCapture() { onResult?(.cancel) }

    private func startEditingText(_ item: AnnotationItem, returnToTool: CaptureTool) {
        commitTextEditor()
        editingTextItem = item
        textEditingReturnTool = returnToTool
        selectedAnnotation = item
        selectedTool = .select
        syncControlsToCurrentTarget()

        let editor = NSTextField(frame: item.rect.standardized.insetBy(dx: -3, dy: -3))
        editor.stringValue = item.text
        editor.font = NSFont.systemFont(ofSize: item.fontSize, weight: .semibold)
        editor.textColor = item.color
        editor.backgroundColor = NSColor.white.withAlphaComponent(0.88)
        editor.isBordered = true
        editor.focusRingType = .none
        editor.delegate = self
        addSubview(editor)
        textEditor = editor
        window?.makeFirstResponder(editor)
        editor.currentEditor()?.selectAll(nil)
        needsDisplay = true
    }

    private func commitTextEditor() {
        guard !isCommittingText, let editor = textEditor, let item = editingTextItem else { return }
        isCommittingText = true
        let value = editor.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        item.text = value
        let fitted = NSString(string: value.isEmpty ? "文字" : value).size(withAttributes: [.font: NSFont.systemFont(ofSize: item.fontSize, weight: .semibold)])
        item.rect.size = CGSize(width: max(item.rect.width, fitted.width + 12), height: max(item.rect.height, fitted.height + 8))
        editor.removeFromSuperview()
        textEditor = nil
        editingTextItem = nil
        let returnTool = textEditingReturnTool ?? .select
        textEditingReturnTool = nil
        if value.isEmpty {
            annotations.removeAll { $0 === item }
            selectedAnnotation = nil
        } else {
            selectedAnnotation = returnTool == .select ? item : nil
        }
        selectedTool = returnTool
        syncControlsToCurrentTarget()
        window?.makeFirstResponder(self)
        isCommittingText = false
        needsDisplay = true
    }

    private func annotation(at point: CGPoint) -> AnnotationItem? {
        annotations.reversed().first { hitTest($0, at: point) }
    }

    private func hitTest(_ item: AnnotationItem, at point: CGPoint) -> Bool {
        switch item.kind {
        case .rectangle, .ellipse, .mosaic, .text:
            return item.rect.standardized.insetBy(dx: -8, dy: -8).contains(point)
        case .arrow:
            return distanceFromPoint(point, toSegmentStart: item.startPoint, end: item.endPoint) <= max(8, item.lineWidth + 5)
        case .pen:
            guard item.points.count > 1 else { return false }
            for index in 1..<item.points.count {
                if distanceFromPoint(point, toSegmentStart: item.points[index - 1], end: item.points[index]) <= max(8, item.lineWidth + 5) {
                    return true
                }
            }
            return false
        case .select:
            return false
        }
    }

    private func resizeHandle(at point: CGPoint, for rect: CGRect) -> ResizeHandle? {
        handleRects(for: rect).first { $0.rect.contains(point) }?.handle
    }

    private func handleRects(for rect: CGRect) -> [(handle: ResizeHandle, rect: CGRect)] {
        let box = rect.standardized
        let size: CGFloat = 9
        let half = size / 2
        let centers: [(ResizeHandle, CGPoint)] = [
            (.topLeft, CGPoint(x: box.minX, y: box.minY)),
            (.top, CGPoint(x: box.midX, y: box.minY)),
            (.topRight, CGPoint(x: box.maxX, y: box.minY)),
            (.right, CGPoint(x: box.maxX, y: box.midY)),
            (.bottomRight, CGPoint(x: box.maxX, y: box.maxY)),
            (.bottom, CGPoint(x: box.midX, y: box.maxY)),
            (.bottomLeft, CGPoint(x: box.minX, y: box.maxY)),
            (.left, CGPoint(x: box.minX, y: box.midY)),
        ]
        return centers.map { handle, center in
            (handle, CGRect(x: center.x - half, y: center.y - half, width: size, height: size))
        }
    }

    private func resized(_ rect: CGRect, by handle: ResizeHandle, to point: CGPoint) -> CGRect {
        var minX = rect.minX
        var minY = rect.minY
        var maxX = rect.maxX
        var maxY = rect.maxY
        switch handle {
        case .topLeft:
            minX = point.x
            minY = point.y
        case .top:
            minY = point.y
        case .topRight:
            maxX = point.x
            minY = point.y
        case .right:
            maxX = point.x
        case .bottomRight:
            maxX = point.x
            maxY = point.y
        case .bottom:
            maxY = point.y
        case .bottomLeft:
            minX = point.x
            maxY = point.y
        case .left:
            minX = point.x
        }
        let standardized = CGRect(x: min(minX, maxX), y: min(minY, maxY), width: abs(maxX - minX), height: abs(maxY - minY))
        return standardized.width < 8 || standardized.height < 8 ? rect : standardized
    }

    private func resizeAnnotation(_ item: AnnotationItem, handle: ResizeHandle, original: AnnotationGeometry, to point: CGPoint, inside selection: CGRect?) {
        let oldBounds = item.bounds
        let newBounds = clamp(resized(oldBounds, by: handle, to: point), inside: selection ?? bounds)
        let old = oldBounds.standardized
        let sx = old.width == 0 ? 1 : newBounds.width / old.width
        let sy = old.height == 0 ? 1 : newBounds.height / old.height

        func transform(_ value: CGPoint) -> CGPoint {
            CGPoint(
                x: newBounds.minX + (value.x - old.minX) * sx,
                y: newBounds.minY + (value.y - old.minY) * sy
            )
        }

        switch item.kind {
        case .rectangle, .ellipse, .mosaic, .text:
            item.rect = newBounds
        case .arrow:
            item.startPoint = transform(original.startPoint)
            item.endPoint = transform(original.endPoint)
        case .pen:
            item.points = original.points.map(transform)
        case .select:
            break
        }
    }

    private func clampAnnotation(_ item: AnnotationItem, inside selection: CGRect?) {
        guard let selection else { return }
        let box = item.bounds
        var delta = CGPoint.zero
        if box.minX < selection.minX { delta.x = selection.minX - box.minX }
        if box.maxX > selection.maxX { delta.x = selection.maxX - box.maxX }
        if box.minY < selection.minY { delta.y = selection.minY - box.minY }
        if box.maxY > selection.maxY { delta.y = selection.maxY - box.maxY }
        item.move(by: delta)
    }

    private func snapped(_ rect: CGRect, threshold: CGFloat) -> CGRect {
        var snapped = rect.standardized
        let candidates = [bounds] + windowSnapRects
        for candidate in candidates {
            if abs(snapped.minX - candidate.minX) <= threshold {
                snapped.origin.x = candidate.minX
            }
            if abs(snapped.maxX - candidate.maxX) <= threshold {
                snapped.size.width = candidate.maxX - snapped.minX
            }
            if abs(snapped.minY - candidate.minY) <= threshold {
                snapped.origin.y = candidate.minY
            }
            if abs(snapped.maxY - candidate.maxY) <= threshold {
                snapped.size.height = candidate.maxY - snapped.minY
            }
        }
        return clamp(snapped.standardized, inside: bounds)
    }

    private func pushHistory() {
        undoStack.append(annotations.map { $0.copyItem() })
        if undoStack.count > 80 {
            undoStack.removeFirst()
        }
        redoStack.removeAll()
    }

    private func restoreLastHistoryIfNoChange() {
        guard let last = undoStack.last else { return }
        if last.map(\.id) == annotations.map(\.id) {
            undoStack.removeLast()
        }
    }

    private func undo() {
        guard let previous = undoStack.popLast() else { return }
        redoStack.append(annotations.map { $0.copyItem() })
        annotations = previous.map { $0.copyItem() }
        selectedAnnotation = nil
        commitTextEditor()
        needsDisplay = true
    }

    private func redo() {
        guard let next = redoStack.popLast() else { return }
        undoStack.append(annotations.map { $0.copyItem() })
        annotations = next.map { $0.copyItem() }
        selectedAnnotation = nil
        commitTextEditor()
        needsDisplay = true
    }
}

private class ColorSwatchButton: NSButton {
    var color: NSColor = .systemRed {
        didSet {
            needsDisplay = true
        }
    }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        isBordered = false
        focusRingType = .none
        wantsLayer = true
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        isBordered = false
        focusRingType = .none
        wantsLayer = true
    }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        let outer = bounds.insetBy(dx: 1, dy: 1)
        let path = NSBezierPath(roundedRect: outer, xRadius: 7, yRadius: 7)
        NSColor.black.withAlphaComponent(0.26).setFill()
        path.fill()

        let colorRect = CGRect(x: outer.minX + 4, y: outer.minY + 4, width: outer.width - 8, height: outer.height - 12)
        color.setFill()
        NSBezierPath(roundedRect: colorRect, xRadius: 4, yRadius: 4).fill()

        let spectrumRect = CGRect(x: outer.minX + 4, y: colorRect.maxY + 2, width: outer.width - 8, height: 4)
        drawHueGradient(in: spectrumRect)

        (state == .on ? NSColor.systemOrange : NSColor.white.withAlphaComponent(0.62)).setStroke()
        path.lineWidth = state == .on ? 2 : 1
        path.stroke()
    }
}

private final class PresetColorButton: ColorSwatchButton {
    var presetColor: NSColor = .white

    override func draw(_ dirtyRect: NSRect) {
        let rect = bounds.insetBy(dx: 2, dy: 2)
        presetColor.setFill()
        NSBezierPath(ovalIn: rect).fill()
        NSColor.black.withAlphaComponent(0.32).setStroke()
        let border = NSBezierPath(ovalIn: rect)
        border.lineWidth = 1
        border.stroke()
    }
}

private final class ColorPickerPopoverView: NSView {
    var onColorChanged: ((NSColor) -> Void)?

    private let field = SaturationBrightnessView(frame: CGRect(x: 12, y: 12, width: 200, height: 128))
    private let hueSlider = HueSliderView(frame: CGRect(x: 12, y: 150, width: 200, height: 18))
    private let preview = ColorPreviewView(frame: CGRect(x: 12, y: 180, width: 44, height: 18))
    private let hexLabel = NSTextField(labelWithString: "")
    private let presetColors: [NSColor] = [
        .systemRed,
        .systemYellow,
        .systemGreen,
        .systemBlue,
        .white,
        .black,
    ]

    init(color: NSColor) {
        super.init(frame: CGRect(x: 0, y: 0, width: 224, height: 210))
        wantsLayer = true
        layer?.cornerRadius = 10
        layer?.masksToBounds = true
        layer?.backgroundColor = NSColor.windowBackgroundColor.withAlphaComponent(0.96).cgColor
        buildSubviews()
        setColor(color, notify: false)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.withAlphaComponent(0.28).setStroke()
        let border = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 10, yRadius: 10)
        border.lineWidth = 1
        border.stroke()
    }

    func setColor(_ color: NSColor, notify: Bool) {
        let normalized = color.usingColorSpace(.deviceRGB) ?? color
        var hue: CGFloat = 0
        var saturation: CGFloat = 0
        var brightness: CGFloat = 0
        var alpha: CGFloat = 1
        normalized.getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: &alpha)
        field.hue = hue
        field.saturation = saturation
        field.brightness = brightness
        hueSlider.hue = hue
        preview.color = normalized
        hexLabel.stringValue = normalized.hexString
        if notify {
            onColorChanged?(normalized)
        }
    }

    private func buildSubviews() {
        field.onColorChanged = { [weak self] color in
            self?.setColor(color, notify: true)
        }
        addSubview(field)

        hueSlider.onHueChanged = { [weak self] hue in
            guard let self else { return }
            field.hue = hue
            let color = NSColor(
                calibratedHue: hue,
                saturation: field.saturation,
                brightness: field.brightness,
                alpha: 1
            )
            setColor(color, notify: true)
        }
        addSubview(hueSlider)

        addSubview(preview)

        hexLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 11, weight: .medium)
        hexLabel.textColor = .secondaryLabelColor
        hexLabel.alignment = .left
        hexLabel.frame = CGRect(x: 64, y: 179, width: 80, height: 20)
        addSubview(hexLabel)

        var x: CGFloat = 126
        for color in presetColors {
            let button = PresetColorButton(frame: CGRect(x: x, y: 178, width: 14, height: 18))
            button.color = color
            button.presetColor = color
            button.target = self
            button.action = #selector(selectPreset(_:))
            addSubview(button)
            x += 15
        }
    }

    @objc private func selectPreset(_ sender: NSButton) {
        guard let sender = sender as? PresetColorButton else { return }
        setColor(sender.presetColor, notify: true)
    }
}

private final class SaturationBrightnessView: NSView {
    var hue: CGFloat = 0 {
        didSet {
            needsDisplay = true
        }
    }
    var saturation: CGFloat = 1 {
        didSet {
            needsDisplay = true
        }
    }
    var brightness: CGFloat = 1 {
        didSet {
            needsDisplay = true
        }
    }
    var onColorChanged: ((NSColor) -> Void)?

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        let rowCount = max(1, Int(bounds.height.rounded()))
        for row in 0..<rowCount {
            let value = 1 - CGFloat(row) / CGFloat(max(1, rowCount - 1))
            let left = NSColor(calibratedWhite: value, alpha: 1)
            let right = NSColor(calibratedHue: hue, saturation: 1, brightness: value, alpha: 1)
            NSGradient(starting: left, ending: right)?.draw(
                in: CGRect(x: 0, y: CGFloat(row), width: bounds.width, height: 1),
                angle: 0
            )
        }

        NSColor.black.withAlphaComponent(0.32).setStroke()
        let border = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 6, yRadius: 6)
        border.lineWidth = 1
        border.stroke()

        let marker = CGPoint(x: saturation * bounds.width, y: (1 - brightness) * bounds.height)
        NSColor.white.setStroke()
        let outer = NSBezierPath(ovalIn: CGRect(x: marker.x - 6, y: marker.y - 6, width: 12, height: 12))
        outer.lineWidth = 2
        outer.stroke()
        NSColor.black.withAlphaComponent(0.75).setStroke()
        let inner = NSBezierPath(ovalIn: CGRect(x: marker.x - 4, y: marker.y - 4, width: 8, height: 8))
        inner.lineWidth = 1
        inner.stroke()
    }

    override func mouseDown(with event: NSEvent) {
        updateColor(with: event)
    }

    override func mouseDragged(with event: NSEvent) {
        updateColor(with: event)
    }

    private func updateColor(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        saturation = min(max(point.x / max(1, bounds.width), 0), 1)
        brightness = 1 - min(max(point.y / max(1, bounds.height), 0), 1)
        onColorChanged?(
            NSColor(
                calibratedHue: hue,
                saturation: saturation,
                brightness: brightness,
                alpha: 1
            )
        )
    }
}

private final class HueSliderView: NSView {
    var hue: CGFloat = 0 {
        didSet {
            needsDisplay = true
        }
    }
    var onHueChanged: ((CGFloat) -> Void)?

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        drawHueGradient(in: bounds)

        NSColor.black.withAlphaComponent(0.32).setStroke()
        let border = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 5, yRadius: 5)
        border.lineWidth = 1
        border.stroke()

        let markerX = hue * bounds.width
        NSColor.white.setStroke()
        let marker = NSBezierPath()
        marker.move(to: CGPoint(x: markerX, y: bounds.minY - 2))
        marker.line(to: CGPoint(x: markerX, y: bounds.maxY + 2))
        marker.lineWidth = 3
        marker.stroke()
        NSColor.black.withAlphaComponent(0.72).setStroke()
        marker.lineWidth = 1
        marker.stroke()
    }

    override func mouseDown(with event: NSEvent) {
        updateHue(with: event)
    }

    override func mouseDragged(with event: NSEvent) {
        updateHue(with: event)
    }

    private func updateHue(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        hue = min(max(point.x / max(1, bounds.width), 0), 1)
        onHueChanged?(hue)
    }
}

private final class ColorPreviewView: NSView {
    var color: NSColor = .systemRed {
        didSet {
            needsDisplay = true
        }
    }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        let rect = bounds.insetBy(dx: 0.5, dy: 0.5)
        color.setFill()
        NSBezierPath(roundedRect: rect, xRadius: 5, yRadius: 5).fill()
        NSColor.black.withAlphaComponent(0.28).setStroke()
        let border = NSBezierPath(roundedRect: rect, xRadius: 5, yRadius: 5)
        border.lineWidth = 1
        border.stroke()
    }
}

private final class LineWidthPreviewView: NSView {
    var color: NSColor = .systemRed {
        didSet {
            needsDisplay = true
        }
    }
    var lineWidth: CGFloat = 4 {
        didSet {
            needsDisplay = true
        }
    }

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        context.setFillColor(NSColor.black.withAlphaComponent(0.18).cgColor)
        context.fill(bounds.insetBy(dx: 0.5, dy: 0.5))
        context.setStrokeColor(color.cgColor)
        context.setLineCap(.round)
        context.setLineWidth(lineWidth)
        context.move(to: CGPoint(x: 8, y: bounds.midY))
        context.addLine(to: CGPoint(x: bounds.width - 8, y: bounds.midY))
        context.strokePath()
    }
}

private extension CaptureInteraction {
    var isDrawingSelection: Bool {
        if case .drawingSelection = self {
            return true
        }
        return false
    }
}

private extension AnnotationGeometry {
    static func == (lhs: AnnotationGeometry, rhs: AnnotationGeometry) -> Bool {
        lhs.rect.equalTo(rhs.rect)
            && lhs.startPoint.equalTo(rhs.startPoint)
            && lhs.endPoint.equalTo(rhs.endPoint)
            && lhs.points == rhs.points
            && lhs.fontSize == rhs.fontSize
    }
}

private extension NSColor {
    var hexString: String {
        let color = usingColorSpace(.sRGB) ?? usingColorSpace(.deviceRGB) ?? self
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 1
        color.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        let r = min(max(Int((red * 255).rounded()), 0), 255)
        let g = min(max(Int((green * 255).rounded()), 0), 255)
        let b = min(max(Int((blue * 255).rounded()), 0), 255)
        return String(format: "#%02X%02X%02X", r, g, b)
    }
}

private func drawHueGradient(in rect: CGRect) {
    let steps = max(1, Int(rect.width.rounded(.up)))
    let stepWidth = rect.width / CGFloat(steps)
    for step in 0..<steps {
        let hue = CGFloat(step) / CGFloat(max(1, steps - 1))
        NSColor(calibratedHue: hue, saturation: 1, brightness: 1, alpha: 1).setFill()
        CGRect(
            x: rect.minX + CGFloat(step) * stepWidth,
            y: rect.minY,
            width: stepWidth + 1,
            height: rect.height
        ).fill()
    }
}

private func clamp(_ point: CGPoint, to rect: CGRect) -> CGPoint {
    CGPoint(
        x: min(max(point.x, rect.minX), rect.maxX),
        y: min(max(point.y, rect.minY), rect.maxY)
    )
}

private func clamp(_ rect: CGRect, inside bounds: CGRect) -> CGRect {
    var value = rect.standardized
    value.size.width = min(value.width, bounds.width)
    value.size.height = min(value.height, bounds.height)
    if value.minX < bounds.minX {
        value.origin.x = bounds.minX
    }
    if value.maxX > bounds.maxX {
        value.origin.x = bounds.maxX - value.width
    }
    if value.minY < bounds.minY {
        value.origin.y = bounds.minY
    }
    if value.maxY > bounds.maxY {
        value.origin.y = bounds.maxY - value.height
    }
    return value.standardized
}

private func distance(_ lhs: CGPoint, _ rhs: CGPoint) -> CGFloat {
    hypot(lhs.x - rhs.x, lhs.y - rhs.y)
}

private func distanceFromPoint(_ point: CGPoint, toSegmentStart start: CGPoint, end: CGPoint) -> CGFloat {
    let dx = end.x - start.x
    let dy = end.y - start.y
    if dx == 0, dy == 0 {
        return distance(point, start)
    }
    let t = max(0, min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)))
    let projection = CGPoint(x: start.x + t * dx, y: start.y + t * dy)
    return distance(point, projection)
}
