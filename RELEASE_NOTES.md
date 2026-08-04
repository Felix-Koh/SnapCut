# SnapCut 2.0.0 — macOS 原生版

SnapCut 2.0.0 是 Apple Silicon macOS 原生版的首个正式版本，也是后续唯一维护的产品主线。应用使用 Swift + AppKit 重写，不再依赖 Electron。

## 主要功能

- `Control + Command + A` 全局快捷键截图。
- 点击窗口自动吸附，也可自由框选、移动和调整选区。
- 矩形、椭圆、箭头、画笔、真实像素化马赛克和文字。
- 已完成标注可重新选择、移动、缩放、改颜色和改粗细，文字可双击继续编辑。
- 内置色盘、无级粗细调节、实时预览、撤销和重做。
- 复制无损 PNG 或保存到本地。
- `Control + Command + R` 选择区域并录制无声 MOV。
- 菜单栏图标可隐藏，隐藏后全局快捷键仍然有效。
- 截图权限会话复用，窗口识别与整屏取帧并行执行。
- 全部截图、标注和录制在本机完成，不上传内容、不包含遥测。

## 下载

- 推荐：`SnapCut-2.0.0-macos-arm64.dmg`
- 备用：`SnapCut-2.0.0-macos-arm64.zip`
- 校验：`SHA256SUMS.txt`

系统要求：Apple Silicon Mac，macOS 13 或更高版本。不提供 Windows 或 Intel Mac 安装包。

## 安装提示

当前包使用临时签名，尚未取得 Apple Developer ID 签名和公证。请只从本 Release 下载，并先使用 `SHA256SUMS.txt` 核对安装包。

如果 macOS 提示“SnapCut 已损坏”，请按照 README 中的步骤先校验 SHA-256、把应用拖入“应用程序”，再只对 `/Applications/SnapCut.app` 清除下载隔离属性。不要全局关闭 Gatekeeper。

## 从旧通用版迁移

Electron 通用版 1.2.8 是最后一个旧版，已停止维护。已经安装 Apple Silicon Mac 版 1.2.8 的用户可以在旧版设置中先点击“检查更新”，再点击“下载并升级”完成一次自动迁移，也可以手动安装本 Release。Windows 旧版不会升级到 2.x。历史 1.x 安装包继续保留，仅用于回退。

## 当前边界

- 区域录制暂时没有系统声音、麦克风、倒计时、暂停和继续。
- 目前“检查更新”会打开正式 Release 页面，尚未自动替换应用。
- 不支持跨屏连续框选、滚动长截图、OCR、贴图和截图历史。
