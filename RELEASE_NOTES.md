## SnapCut v1.2.3

SnapCut 是一个快速、独立、常驻后台的 Windows / macOS 截图工具。

### 本次更新

- 修复点击“下载并升级”后可能出现 `TypeError: fetch failed`、无法下载安装包的问题
- 更新器改用 Windows / macOS 的系统网络通道，自动沿用系统代理与证书设置
- 网络或安全证书仍受阻时显示清晰中文提示，便于检查代理、VPN 或系统证书
- 继续执行 HTTPS 域名限制、安装包大小限制和 SHA-256 完整性校验
- 增加更新网络失败与系统网络通道的自动回归测试

### 从 1.2.2 升级

如果 `1.2.2` 点击“下载并升级”显示 `TypeError: fetch failed`，请从本 Release 手动下载安装 `1.2.3` 一次。安装完成后，后续版本的一键升级会使用本次修好的系统网络通道。

### 主要功能

- 熟悉的快捷键截图：Windows `Alt + A`，macOS `Control + Command + A`
- 区域截图、双击整屏、移动与八方向调整
- 像素放大镜和准确的高 DPI 输出尺寸
- 矩形、椭圆、箭头、画笔、马赛克、文字
- 撤销 / 重做、复制到剪贴板、保存 PNG
- 托盘 / 菜单栏常驻、可选开机启动
- 全部本机处理，不上传截图，不包含遥测

### 下载哪个文件

- Windows 10 / 11 64 位：`SnapCut-1.2.3-windows-x64.exe`
- Apple Silicon Mac（M 系列，macOS 12 或更高版本）：`SnapCut-1.2.3-macos-arm64.dmg`

ZIP 是 macOS 免挂载压缩包；一般安装优先使用 DMG。

### 未签名说明

当前 Release 尚未使用 Apple / Windows 代码签名证书，系统会显示“无法验证开发者”或“未知发布者”提醒。请只从本 GitHub Release 下载，并用 `SHA256SUMS.txt` 核对文件；不要关闭 Gatekeeper 或 SmartScreen。详细开启方法见 README。

### 已知边界

- 每次在鼠标所在的一块显示器内框选，暂不支持跨屏连续选择。
- 当系统不允许读取某个窗口边界时，仍可手动框选。
- DRM 视频、安全桌面或硬件叠加层可能无法截图。
- 暂不包含长截图、OCR、贴图、录屏和截图历史。
