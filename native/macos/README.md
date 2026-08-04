# SnapCut macOS 原生版

这是当前唯一维护的 SnapCut 版本，使用 Swift + AppKit 开发，面向 Apple Silicon 和 macOS 13 或更高版本。

## 构建与运行

```bash
./build-app.sh
open build/SnapCut.app
```

生成 Release 使用的 DMG 和 ZIP：

```bash
./package-release.sh
```

输出位于 `dist/`。

## 使用

- 截图：`Control + Command + A`
- 区域录制：`Control + Command + R`
- 复制截图：`Enter` 或 `Command + C`
- 保存截图：`Command + S`
- 取消：`Esc`

第一次截图或录制时，需要在“系统设置 → 隐私与安全性 → 屏幕录制”中允许 SnapCut。

## 当前功能

- 菜单栏常驻，可选择隐藏图标，隐藏后快捷键仍然有效。
- 点击窗口自动吸附，自由框选、移动和八方向调整选区。
- 像素放大镜、物理像素尺寸提示和底部居中浮动控制栏。
- 矩形、椭圆、箭头、画笔、真实像素化马赛克和文字。
- 连续绘制、Shift 等比例、标注重新选择、移动、缩放、改色和改粗细。
- 截图蒙层内置色盘和无级粗细滑杆。
- 撤销、重做、复制 PNG、保存 PNG。
- 无声区域录制，MOV 自动保存到 `~/Movies/SnapCut`。
- 菜单栏手动检查 GitHub Release 更新。
- 权限结果会在本次运行中复用，窗口识别和整屏取帧并行执行。

## 当前边界

- 只支持 Apple Silicon，不发布 Intel Mac 版本。
- 区域录制暂时没有音频、倒计时、暂停和继续。
- 当前使用临时签名，尚未接入 Apple Developer ID、公证和自动安装更新。
- 每次重新打包后的第一次 Finder 启动可能包含额外的 macOS 安全检查。

旧 Electron 通用版停在 1.2.8，仅保留源码和历史安装包，不再维护。
