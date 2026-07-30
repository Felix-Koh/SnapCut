# SnapCut（快截）

快速、独立、常驻后台的 Windows / macOS 截图与标注工具。

[下载最新版本](https://github.com/Felix-Koh/SnapCut/releases/latest) · [查看隐私说明](PRIVACY.md) · [报告问题](https://github.com/Felix-Koh/SnapCut/issues)

## 为什么做 SnapCut

SnapCut 把常用截图能力集中在一个轻量、独立、常驻后台的桌面工具里：按快捷键、框选、标注、复制，然后继续手上的工作。

截图和标注都在本机完成。SnapCut 不上传图片、不收集使用数据，也不包含广告、账号或云服务。

## 功能

- 全局快捷键：Windows 默认 `Alt + A`，macOS 默认 `Control + Command + A`
- 鼠标悬停自动识别窗口，单击选中窗口；拖动仍可自由框选，双击可选择整块显示器
- 选区移动、八方向缩放、物理像素尺寸提示
- 像素放大镜、坐标与颜色取样
- 矩形、椭圆、箭头、画笔、马赛克、文字
- 完成后的标注可重新选中、移动、缩放、改色和改粗细；文字可双击修改内容
- 每种标注工具独立记住颜色和粗细，支持自定义颜色与连续滑杆调节
- 颜色与粗细弹层自动对齐，粗细调整时提供实时预览
- 撤销、重做
- 一键复制到剪贴板，或保存为无损 PNG
- 后台预热截图界面，减少按快捷键后等待时间
- 系统托盘 / 菜单栏常驻，可随时隐藏图标或选择开机启动
- 软件内检查更新、下载进度与一键升级，安装包下载后自动核验 SHA-256
- Retina 与 Windows 高 DPI 缩放适配
- 无遥测、无截图上传、无截图历史；网络仅用于从本仓库检查和下载正式版本

## 下载和安装

请前往 [GitHub Releases](https://github.com/Felix-Koh/SnapCut/releases) 下载：

| 系统 | 文件 | 适用设备 |
|---|---|---|
| Windows 10 / 11 | `SnapCut-1.2.8-windows-x64.exe` | 64 位 Intel / AMD 电脑 |
| macOS Apple Silicon | `SnapCut-1.2.8-macos-arm64.dmg` | macOS 12 或更高版本，M1、M2、M3、M4、M5 等 Mac |

### 首版未签名提示

当前版本没有使用 Apple Developer ID 或 Windows Authenticode 证书签名，因此系统会显示正常的安全提醒：

- Windows：如果 SmartScreen 显示“未知发布者”，确认下载来源为本仓库 Release 后，点击“更多信息”→“仍要运行”。
- macOS：首次打开时可在 Finder 中右键 SnapCut →“打开”；也可在“系统设置”→“隐私与安全性”中确认打开。

不要关闭系统安全功能。Release 同时提供 `SHA256SUMS.txt`，可用于核对安装包是否与发布文件一致。正式推广版本会在取得代码签名证书后补上签名与 Apple 公证。

### macOS 提示“SnapCut 已损坏，无法打开”

当前 macOS 安装包尚未使用 Apple Developer ID 签名和公证。通过浏览器下载后，macOS 会给应用添加隔离标记；Gatekeeper 有时会因此显示“已损坏”或要求将应用移到废纸篓。这不一定代表安装包真的损坏，但在继续前必须先确认文件来自本仓库并通过校验。

1. 只从本仓库的 [GitHub Releases](https://github.com/Felix-Koh/SnapCut/releases) 下载 Apple Silicon DMG，同时下载同一版本的 `SHA256SUMS.txt`。
2. 在“终端”中核对下载文件。文件名中的版本号变化时，请使用实际下载的文件名：

   ```bash
   shasum -a 256 ~/Downloads/SnapCut-*-macos-arm64.dmg
   ```

   输出的 SHA-256 必须与 `SHA256SUMS.txt` 中对应 DMG 的记录完全一致。若不一致，请删除文件并重新下载，不要继续打开。
3. 打开 DMG，把 `SnapCut.app` 拖入“应用程序”，然后推出 DMG。
4. 先在 Finder 的“应用程序”中右键 SnapCut，选择“打开”。如果仍然提示“已损坏”，在“终端”中只对 SnapCut 执行：

   ```bash
   xattr -dr com.apple.quarantine "/Applications/SnapCut.app"
   open "/Applications/SnapCut.app"
   ```

   如果 SnapCut 不在 `/Applications`，请把命令中的路径替换为实际位置；也可以在输入 `xattr -dr com.apple.quarantine ` 后，把 `SnapCut.app` 从 Finder 拖入终端，让系统自动填入正确路径。

不要执行全局关闭 Gatekeeper 的命令，也不要对整个“应用程序”目录批量清除隔离属性。以上命令只应在安装包来源和 SHA-256 已确认后，针对 `/Applications/SnapCut.app` 使用。

## 第一次使用

1. 启动 SnapCut。关闭设置窗口后，程序仍会留在 Windows 托盘或 macOS 菜单栏。
2. macOS 首次截图会请求“屏幕与系统音频录制”权限。SnapCut 只读取截图画面，不录制音频，也不会后台连续录屏。
3. 如果 macOS 要求重启应用，退出并重新打开 SnapCut。
4. 按全局快捷键，移到目标窗口后单击选中，或拖动自由选择区域。
5. 直接按 `Enter` 复制并完成，或使用下方工具栏标注、保存。

### 调整或隐藏菜单栏图标

macOS 不允许应用自行指定菜单栏图标的左右位置。按住 `Command` 后拖动 SnapCut 图标，可以把它移动到你习惯的位置；实际最左边界仍由 macOS 的系统区域和其他图标决定。

如果不想显示图标，可在 SnapCut 设置的“常规设置”中关闭“在菜单栏显示图标”。关闭后 SnapCut 仍在后台运行，全局截图快捷键不受影响。从 Finder 的“应用程序”中再次打开 SnapCut，会重新显示设置窗口，可随时恢复该开关。

## 软件更新

在 SnapCut 设置页点击“检查更新”。发现新版本后点击“下载并升级”，SnapCut 会从本仓库的正式 Release 下载当前系统对应的安装包，并使用 `SHA256SUMS.txt` 自动校验：

- Windows：校验成功后自动启动新版安装程序并退出当前版本。
- Apple Silicon Mac：从 `1.2.6` 开始，校验成功后会自动退出旧版本、静默挂载 DMG、替换应用并启动新版本，不需要再打开 DMG 或手动拖动。安装助手会先保留旧版本备份；如果新版未能稳定启动，会自动恢复并重新打开旧版。

应用启动后也会延迟检查一次更新，不会阻塞启动，不会上传截图或使用数据。

从 `1.2.3` 开始，更新下载使用系统网络通道，会自动沿用 Windows / macOS 的系统代理与证书设置。如果仍提示无法连接或无法验证安全证书，请暂时切换代理或 VPN 节点，或检查系统时间和代理证书后重试；SnapCut 不会关闭 HTTPS 证书校验。

如果使用 `1.2.4` 或更早版本，第一次升级到 `1.2.6` 仍需手动安装一次，因为旧版本内部还没有自动替换助手。安装 `1.2.6` 后，之后的软件更新才会完成下载、校验、替换和重启的全自动流程。

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

文字输入时，`Enter` 换行，点击画面空白处或按 `Ctrl / Command + Enter` 会保留文字，`Esc` 放弃本次文字。

完成标注后按 `V` 切回选择工具，再单击标注即可重新编辑：拖动标注可移动，拖动橙色控制点可缩放，颜色和粗细按钮会修改当前标注；方向键可以微调位置，`Delete / Backspace` 删除。双击文字可重新修改文字内容。

> 马赛克用于视觉弱化。真正的机密信息，建议在发送前使用不透明色块完全遮挡并再次确认。

## 当前边界

- 每次截取鼠标所在的一块显示器，不支持跨屏连续框选。
- 系统面板、DRM 视频、安全桌面和部分硬件叠加层可能无法识别边界或返回黑色画面；此时仍可手动框选。
- SnapCut 不尝试绕过系统或内容保护。
- 暂不包含滚动长截图、OCR、贴图、截图历史和录屏。

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

推送与 `package.json` 版本一致的标签（例如 `v1.2.8`）后，GitHub Actions 会：

1. 在 Windows 与 Apple Silicon macOS 的原生 Runner 上分别检查、构建并做启动烟雾测试；
2. 核验 1 个 EXE、1 个 DMG、1 个 ZIP；
3. 生成 SHA-256 校验文件；
4. 所有文件齐全后才发布 GitHub Release，避免用户下载到半成品。

## License

[MIT](LICENSE)
