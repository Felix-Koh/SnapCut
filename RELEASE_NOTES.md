## SnapCut v1.0.1

SnapCut 是一个快速、独立、常驻后台的 Windows / macOS 截图工具。

### 首版功能

- 熟悉的快捷键截图：Windows `Alt + A`，macOS `Control + Command + A`
- 区域截图、双击整屏、移动与八方向调整
- 像素放大镜和准确的高 DPI 输出尺寸
- 矩形、椭圆、箭头、画笔、马赛克、文字
- 撤销 / 重做、复制到剪贴板、保存 PNG
- 托盘 / 菜单栏常驻、可选开机启动
- 全部本机处理，不上传截图，不包含遥测

### 下载哪个文件

- Windows 10 / 11 64 位：`SnapCut-1.0.1-windows-x64.exe`
- Apple Silicon Mac（M 系列，macOS 12 或更高版本）：`SnapCut-1.0.1-macos-arm64.dmg`

ZIP 是 macOS 免挂载压缩包；一般安装优先使用 DMG。

### 未签名说明

当前 Release 尚未使用 Apple / Windows 代码签名证书，系统会显示“无法验证开发者”或“未知发布者”提醒。请只从本 GitHub Release 下载，并用 `SHA256SUMS.txt` 核对文件；不要关闭 Gatekeeper 或 SmartScreen。详细开启方法见 README。

### 已知边界

- 每次在鼠标所在的一块显示器内框选，暂不支持跨屏连续选择。
- v1 以手动框选为主，不包含窗口自动吸附。
- DRM 视频、安全桌面或硬件叠加层可能无法截图。
- 暂不包含长截图、OCR、贴图、录屏、截图历史和自动更新。
