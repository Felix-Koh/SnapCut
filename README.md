# SnapCut（快截）

快速、独立、常驻后台的 Windows / macOS 截图与标注工具。

[下载最新版本](https://github.com/Felix-Koh/SnapCut/releases/latest) · [查看隐私说明](PRIVACY.md) · [报告问题](https://github.com/Felix-Koh/SnapCut/issues)

## 为什么做 SnapCut

SnapCut 把常用截图能力集中在一个轻量、独立、常驻后台的桌面工具里：按快捷键、框选、标注、复制，然后继续手上的工作。

截图和标注都在本机完成。SnapCut 不上传图片、不收集使用数据，也不包含广告、账号或云服务。

## 功能

- 全局快捷键：Windows 默认 `Alt + A`，macOS 默认 `Control + Command + A`
- 鼠标所在显示器的区域截图；双击可选择整块显示器
- 选区移动、八方向缩放、物理像素尺寸提示
- 像素放大镜、坐标与颜色取样
- 矩形、椭圆、箭头、画笔、马赛克、文字
- 六种颜色与三档线宽 / 笔刷 / 字号
- 撤销、重做
- 一键复制到剪贴板，或保存为无损 PNG
- 系统托盘 / 菜单栏常驻、可选开机启动
- Retina 与 Windows 高 DPI 缩放适配
- 无网络功能、无遥测、无截图历史

## 下载和安装

请前往 [GitHub Releases](https://github.com/Felix-Koh/SnapCut/releases) 下载：

| 系统 | 文件 | 适用设备 |
|---|---|---|
| Windows 10 / 11 | `SnapCut-1.0.1-windows-x64.exe` | 64 位 Intel / AMD 电脑 |
| macOS Apple Silicon | `SnapCut-1.0.1-macos-arm64.dmg` | macOS 12 或更高版本，M1、M2、M3、M4、M5 等 Mac |

### 首版未签名提示

当前版本没有使用 Apple Developer ID 或 Windows Authenticode 证书签名，因此系统会显示正常的安全提醒：

- Windows：如果 SmartScreen 显示“未知发布者”，确认下载来源为本仓库 Release 后，点击“更多信息”→“仍要运行”。
- macOS：首次打开时可在 Finder 中右键 SnapCut →“打开”；也可在“系统设置”→“隐私与安全性”中确认打开。

不要关闭系统安全功能。Release 同时提供 `SHA256SUMS.txt`，可用于核对安装包是否与发布文件一致。正式推广版本会在取得代码签名证书后补上签名与 Apple 公证。

## 第一次使用

1. 启动 SnapCut。关闭设置窗口后，程序仍会留在 Windows 托盘或 macOS 菜单栏。
2. macOS 首次截图会请求“屏幕与系统音频录制”权限。SnapCut 只读取截图画面，不录制音频，也不会后台连续录屏。
3. 如果 macOS 要求重启应用，退出并重新打开 SnapCut。
4. 按全局快捷键，拖动选择区域。
5. 直接按 `Enter` 复制并完成，或使用下方工具栏标注、保存。

## 截图中的快捷键

| 操作 | Windows | macOS |
|---|---|---|
| 开始截图 | `Alt + A` | `Control + Command + A` |
| 复制并完成 | `Enter` / `Ctrl + C` | `Enter` / `Command + C` |
| 保存 PNG | `Ctrl + S` | `Command + S` |
| 撤销 | `Ctrl + Z` | `Command + Z` |
| 重做 | `Ctrl + Shift + Z` / `Ctrl + Y` | `Command + Shift + Z` |
| 取消 | `Esc` | `Esc` |
| 选择 / 移动 | `V` | `V` |
| 矩形 / 椭圆 / 箭头 | `R` / `O` / `A` | `R` / `O` / `A` |
| 画笔 / 马赛克 / 文字 | `P` / `B` / `T` | `P` / `B` / `T` |
| 开关放大镜 | `M` | `M` |
| 微调选区 | 方向键；按住 `Shift` 为 10 像素 | 方向键；按住 `Shift` 为 10 像素 |

文字输入时，`Enter` 换行，`Ctrl / Command + Enter` 完成文字，`Esc` 放弃本次文字。

> 马赛克用于视觉弱化。真正的机密信息，建议在发送前使用不透明色块完全遮挡并再次确认。

## 当前边界

- v1 每次截取鼠标所在的一块显示器，不支持跨屏连续框选。
- 纯 Electron 无法可靠取得其他应用窗口的精确边界，因此 v1 不提供“悬停自动吸附窗口”；仍可快速手动框选或双击整屏。
- DRM 视频、系统安全桌面、部分硬件叠加层可能返回黑色画面，SnapCut 不尝试绕过系统或内容保护。
- 暂不包含滚动长截图、OCR、贴图、截图历史、录屏和自动更新。

## 本地开发

要求 Node.js 24 或更高版本。

```bash
npm ci
npm run check
npm start
```

生成图标：

```bash
npm run icons
```

本机打包：

```bash
npm run dist:mac:arm64   # Apple Silicon Mac
npm run dist:win         # Windows x64
```

应用采用 Electron 43，渲染进程启用 sandbox 与 context isolation，关闭 Node.js integration；截图数据只在内存中处理，主进程仅负责系统截图、剪贴板和保存对话框。

## 发布

推送与 `package.json` 版本一致的标签（例如 `v1.0.1`）后，GitHub Actions 会：

1. 在 Windows 与 Apple Silicon macOS 的原生 Runner 上分别检查、构建并做启动烟雾测试；
2. 核验 1 个 EXE、1 个 DMG、1 个 ZIP；
3. 生成 SHA-256 校验文件；
4. 所有文件齐全后才发布 GitHub Release，避免用户下载到半成品。

## License

[MIT](LICENSE)
