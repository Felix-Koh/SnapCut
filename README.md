# SnapCut（快截）

面向 Apple Silicon Mac 的原生截图、标注与区域录制工具。使用 Swift + AppKit 开发，常驻菜单栏，截图和录制均在本机完成。

[下载最新版本](https://github.com/Felix-Koh/SnapCut/releases/latest) · [隐私说明](PRIVACY.md) · [报告问题](https://github.com/Felix-Koh/SnapCut/issues)

> 当前唯一维护版本是 2.x 原生 macOS 版。旧 Electron 通用版已停在 1.2.8，仅保留历史源码和安装包，不再发布 Windows、Intel Mac 或旧通用版更新。

## 主要功能

- `Control + Command + A` 全局快捷键截图。
- 点击窗口自动吸附，也可自由拖动框选并调整选区。
- 像素放大镜与物理像素尺寸提示。
- 矩形、椭圆、箭头、画笔、真实像素化马赛克和文字。
- 标注完成后可重新选择、移动、缩放、改颜色和改粗细；文字可双击继续编辑。
- 每个工具独立记住颜色和粗细，支持内置色盘与无级滑杆。
- 撤销、重做、复制 PNG、保存 PNG。
- `Control + Command + R` 选择区域并录制无声 MOV，文件保存到 `~/Movies/SnapCut`。
- 菜单栏图标可隐藏，全局快捷键仍然可用。
- 无遥测、无广告、无账号、无截图上传。

## 下载与安装

当前正式版只支持 Apple Silicon 和 macOS 13 或更高版本。

| 文件 | 用途 |
|---|---|
| `SnapCut-2.0.0-macos-arm64.dmg` | 推荐安装包，适用于 M 系列 Mac |
| `SnapCut-2.0.0-macos-arm64.zip` | 备用压缩包 |
| `SHA256SUMS.txt` | 安装包 SHA-256 校验值 |

从 [GitHub Releases](https://github.com/Felix-Koh/SnapCut/releases) 下载 DMG，打开后把 `SnapCut.app` 拖入“应用程序”。

### macOS 提示“SnapCut 已损坏”

当前安装包使用临时签名，尚未取得 Apple Developer ID 签名和公证。浏览器下载后，Gatekeeper 可能显示“已损坏”或要求移到废纸篓。

继续前请先确认文件来自本仓库，并核对 SHA-256：

```bash
shasum -a 256 ~/Downloads/SnapCut-2.0.0-macos-arm64.dmg
```

输出必须与同一 Release 中 `SHA256SUMS.txt` 的对应记录完全一致。安装到“应用程序”后，先右键 SnapCut 并选择“打开”。如果仍然提示损坏，只对 SnapCut 执行：

```bash
xattr -dr com.apple.quarantine "/Applications/SnapCut.app"
open "/Applications/SnapCut.app"
```

不要全局关闭 Gatekeeper，也不要对整个“应用程序”目录批量清除隔离属性。

## 第一次使用

1. 打开 SnapCut，在“系统设置 → 隐私与安全性 → 屏幕录制”中允许 SnapCut。
2. 如果 macOS 要求重新打开应用，请退出后再次启动。
3. 按 `Control + Command + A`，点击目标窗口自动选择，或拖动框选区域。
4. 添加标注后按 `Enter` 或 `Command + C` 复制，也可按 `Command + S` 保存 PNG。

按住 `Command` 可拖动菜单栏中的 SnapCut 图标。也可以在“偏好设置”中隐藏图标；隐藏后快捷键仍然有效，再次从“应用程序”打开 SnapCut 可恢复设置入口。

## 检查更新

在菜单栏选择“检查更新”。SnapCut 只会读取本仓库最新 Release 的版本信息；发现新版后可以点击按钮打开正式发布页。由于当前安装包尚未正式签名和公证，2.0.0 暂不提供自动替换安装，升级时请重新下载 DMG。

已经安装 Apple Silicon Mac 通用版 1.2.8 的用户，可以在旧版设置中执行一次“下载并升级”，自动迁移到原生 2.0.0；该迁移路径已经过实际替换与重启验证。Windows 1.2.8 不会升级到 2.x。

## 快捷键

| 操作 | 快捷键 |
|---|---|
| 开始截图 | `Control + Command + A` |
| 开始 / 停止区域录制 | `Control + Command + R` |
| 复制并完成 | `Enter` / `Command + C` |
| 保存 PNG | `Command + S` |
| 撤销 / 重做 | `Command + Z` / `Command + Shift + Z` |
| 取消 | `Esc` |
| 选择 / 移动 | `V` |
| 矩形 / 椭圆 / 箭头 | `R` / `O` / `A` |
| 画笔 / 马赛克 / 文字 | `P` / `B` / `T` |
| 开关放大镜 | `M` |
| 微调选区或标注 | 方向键；按住 `Shift` 为 10 像素 |

矩形和椭圆绘制或缩放时按住 `Shift` 可锁定正方形或正圆。完成标注后按 `V`，再点击标注即可继续编辑。

> 马赛克用于视觉弱化。真正的机密信息建议使用不透明色块完全遮挡，并在发送前再次确认。

## 当前边界

- 每次在鼠标所在的一块显示器内截图或录制，不支持跨屏连续框选。
- 区域录制当前没有系统声音、麦克风、倒计时、暂停和继续。
- DRM 视频、安全桌面和部分硬件叠加层可能无法截取。
- 暂不包含滚动长截图、OCR、贴图和截图历史。
- 正式签名、公证和自动安装更新尚未接入。

## 旧通用版（Legacy）

Electron 通用版最终版本为 `1.2.8`。历史 Windows 和 macOS 安装包继续保留在 Releases 供已安装用户回退，但不再维护、不再接收功能更新，也不会随 2.x 发布 Windows 或 Intel Mac 安装包。仓库中的 `src/`、`test/` 和 `package.json` 仅作为旧版源码存档。

## 本地开发

要求 Apple Silicon Mac、macOS 13+ 和 Swift 6：

```bash
cd native/macos
./build-app.sh
open build/SnapCut.app
```

生成正式发布结构的 DMG 和 ZIP：

```bash
cd native/macos
./package-release.sh
```

推送与 `native/macos/Info.plist` 一致的标签后，GitHub Actions 会只构建原生 macOS arm64 版本，验证架构、版本和签名，生成 DMG、ZIP 与 `SHA256SUMS.txt`，然后发布 Release。

## License

[MIT](LICENSE)
