# SnapCut macOS 原生版

这是 SnapCut 的 macOS 原生重写，不替换当前 Electron 版本。第一阶段先验证低内存、低延迟的截图主链路：菜单栏常驻、全局快捷键、屏幕选区、复制 PNG 和保存 PNG。

## 要求

- Apple Silicon Mac
- macOS 13 或更高版本
- Swift 6 / Xcode Command Line Tools

## 构建和运行

\`\`\`bash
./build-app.sh
open build/SnapCut.app
\`\`\`

第一次截图时，macOS 会要求授予“屏幕录制”权限。权限路径是“系统设置 → 隐私与安全性 → 屏幕录制”。

默认快捷键是 \`Control + Command + A\`。框选后可以点击“复制”或“保存”，也可以使用 \`Enter\` / \`Command + C\` 复制，\`Command + S\` 保存，\`Esc\` 取消。

## 当前边界

这一阶段还没有迁移完整标注工具、窗口自动吸附、设置页、自动更新、签名和公证。它们会在截图主链路通过真实 Mac 验收后逐步加入。现有 Electron 版保持不变。
