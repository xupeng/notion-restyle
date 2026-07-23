# Notion Restyle

Notion Restyle 是一个为 macOS Notion Desktop 注入个人自定义样式的工具。它通过
Chrome DevTools Protocol（CDP）在 renderer 内存中加载 CSS，不修改 Notion
安装包、`app.asar`、代码签名或 `~/.config/notion`。

## 要求

- macOS
- 官方 Notion Desktop（Bundle ID 为 `notion.id`）
- Node.js 22 或更高版本
- CSS 中 Google Fonts 首次加载时需要网络连接

工具会依次在当前 `PATH`、Homebrew 常用路径和 `~/.nvm/versions/node` 中查找
Node。也可以设置 `NOTION_RESTYLE_NODE` 指定 runtime；非标准 Notion 安装路径可用
`NOTION_APP_BUNDLE` 指定。

## 使用

推荐在 Raycast 中运行 **Notion with Restyle**。Script Command 位于：

```text
raycast/notion-with-restyle.sh
```

Raycast 的 Script Commands 目录应包含：

```text
/Users/xupeng/dev/personal/notion-restyle/raycast
```

也可以直接使用项目根目录命令：

- `Apply.command`：启动或重新应用自定义样式
- `Status.command`：检查进程、随机端口和各 Notion renderer 的注入状态
- `Restore.command`：移除样式并按普通模式重新启动 Notion

运行状态和日志位于：

```text
~/Library/Application Support/NotionRestyle
```

## 自定义样式

编辑 [`assets/notion-custom.css`](./assets/notion-custom.css)。Notion 已由 Notion
Restyle 启动时，保存后会自动热更新到现有标签页；新标签页和页面重载也会自动注入。

项目中的初始 CSS 是 `/Users/xupeng/.config/notion/custom.css` 的快照。后续运行只读取
项目内文件，不读取或修改 `~/.config/notion/custom.css`、`gist.json`、Gist 缓存或
旧 `notion-font-customizer` 的其他配置。

## 正文与 AI 对话缩放

Notion Restyle 可以分别缩放笔记正文和 AI 对话界面。正文缩放不改变普通页面标题、属性、
评论、侧边栏或顶部栏；popup Feed view 内的整张内容卡片与正文共享同一缩放比例，但
popup 外框、视图标签、工具栏和按钮保持不变。AI 对话缩放只作用于侧栏或全屏对话中的
历史消息，包括用户消息、AI 回复以及消息内的代码块、卡片和附件。标题、对话名称、输入区
和按钮保持不变。正文中的图片会随正文放大，但宽图达到正文可视边界后会自动等比收缩，
始终完整显示：

- `Control` + `Shift` + `+`：放大 5%
- `Control` + `Shift` + `-`：缩小 5%
- `Control` + `Shift` + `0`：恢复 100%

正文、全屏 AI 对话和侧栏 AI 对话分别使用独立比例，缩放范围均为 60%–160%。文档与
侧栏对话同时显示时，快捷键作用于最近点击或获得输入焦点的区域；全屏对话始终缩放
全屏 AI 对话比例，侧栏操作只修改侧栏 AI 对话比例。

当前目标及比例会短暂显示在页面底部，并由 Notion 的本地存储保存；所有笔记和标签页
共用这三份比例，刷新或重启后仍会保留。首次升级时，如果两个新 AI 比例尚未保存，会
使用旧的共享 AI 比例作为各自的初始值。`Restore.command` 只移除当前注入效果，不删除
已保存的比例。Notion 原有的 `Command` + `+` / `-` 整窗缩放快捷键保持不变。

## 配置固定端口

默认情况下，每个新的 Notion Restyle 会话都会随机选择 CDP 端口。如需使用固定
端口，将示例配置复制为项目根目录的 `.env`，并设置：

```dotenv
NOTION_RESTYLE_PORT=54321
```

端口必须是 `1024–65535` 中当前未被占用的整数。配置无效、重复或端口已被占用时，
Apply 会明确报错，不会回退到随机端口。`.env` 只在新的 Notion Restyle 会话启动时
决定端口；已有会话会继续使用当前端口，修改后的配置将在下次启动时生效。

## 工作方式

未配置 `.env` 时，每次创建新的 Restyle 会话都会在 `49152–65535` 中随机选择端口；
配置 `NOTION_RESTYLE_PORT` 后则使用指定端口。两种方式都只监听 `127.0.0.1`，并通过
一次性 launchd submitted job 启动后台 watcher；它不会安装
LaunchAgent，也不会随登录自动启动。watcher 仅连接
`https://app.notion.com/*` 页面，排除 Notion 的 `file://` 标签栏 shell 和其他
renderer。退出 Notion 后 watcher 和临时 launchd job 会自动结束，并只删除属于自己
的 state 文件。

普通方式启动 Notion 不会开放 CDP，因此需要样式时应通过 Apply 或 Raycast 启动。
同一 Restyle 会话中修改 CSS 不需要重启。

## 安全边界

工具在运行前校验 Notion 的 Bundle ID、官方 Team ID、Apple designated requirement 和
notarization metadata。它不会修改 `.app` 内容，因此不会进一步改变应用签名状态，也
不需要在 Notion 更新后重新 patch。

随机端口只能降低被直接猜中的概率，固定端口和随机端口都不能为 CDP 提供身份验证。
本机其他进程仍可能访问或扫描 loopback listener。不使用自定义样式时运行
`Restore.command`，即可关闭 watcher 和带 CDP 的 Notion 会话。

## 开发与检查

```bash
npm test
npm run doctor
```

doctor 只读检查项目文件、Shell/Node 语法、Node runtime 和 Notion 签名，不会重启
Notion。

## 当前版本边界

仅支持当前官方 macOS Notion 和 `https://app.notion.com` renderer，不保留旧域名或
旧 Electron 版本的兼容分支。Notion 改变页面域名、CDP 行为或 DOM 结构后，需要更新
target 校验或自定义 CSS 选择器。
