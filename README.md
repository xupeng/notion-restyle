# Notion Restyle

Notion Restyle 为 macOS Notion Desktop 和浏览器中的 Notion 提供个人自定义样式与
正文／AI 对话独立缩放。桌面版通过 Chrome DevTools Protocol（CDP）在 renderer
内存中加载 CSS，不修改 Notion 安装包、`app.asar`、代码签名或 `~/.config/notion`；
浏览器版通过 ScriptCat 用户脚本运行，共用同一份 CSS 和缩放源码。

**浏览器安装：** [安装 Notion Restyle 用户脚本（ScriptCat）](https://raw.githubusercontent.com/xupeng/notion-restyle/master/userscripts/notion-restyle.user.js)

## 桌面版要求

- macOS
- 官方 Notion Desktop（Bundle ID 为 `notion.id`）
- Node.js 22 或更高版本
- CSS 中 Google Fonts 首次加载时需要网络连接

工具会依次在当前 `PATH`、Homebrew 常用路径和 `~/.nvm/versions/node` 中查找
Node。也可以设置 `NOTION_RESTYLE_NODE` 指定 runtime；非标准 Notion 安装路径可用
`NOTION_APP_BUNDLE` 指定。

## 桌面版使用

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

## 浏览器版（ScriptCat）

构建时需要 Node.js 22 或更高版本；运行时只需要浏览器和 ScriptCat，不需要 macOS、
Notion Desktop、CDP 或后台 watcher。

### 从 GitHub 安装（推荐）

先安装并启用 ScriptCat，然后点击：

**[安装 Notion Restyle 用户脚本](https://raw.githubusercontent.com/xupeng/notion-restyle/master/userscripts/notion-restyle.user.js)**

链接指向公开仓库 `master` 分支上 `userscripts/notion-restyle.user.js` 的 Raw 文件，
不是 GitHub 代码预览页。ScriptCat 识别后确认安装，再刷新 Notion 标签页。
如果之前已在 Stylus 中安装本项目的 CSS，请关闭那份样式，避免重复维护。
脚本内置同一 Raw 地址的 `@updateURL` 和 `@downloadURL`；发布更高版本后，可在
ScriptCat 中检查更新。**文件首次提交并推送到 `master` 后，安装链接才会生效。**

### 本地构建与安装

在项目根目录运行：

```bash
npm run build:userscript
```

生成文件位于 `userscripts/notion-restyle.user.js`，纳入 Git 版本管理。在 ScriptCat 管理界面中新建普通用户脚本，
用生成文件的**全部内容**替换默认模板，保存并启用，然后刷新 Notion 标签页。
本地构建同样内置 GitHub 更新地址；未发布的本地修改不会自动上传到 GitHub。

生成脚本内嵌 `assets/notion-custom.css` 与 `assets/renderer-inject.js`，不会运行时下载
CSS 或 JS，也不需要 `eval`、网络请求权限或页面内部对象访问。已有的 Google Fonts
加载仍需要网络，本机中文字体与代码字体要求见下文。

适用地址限定为 HTTPS 的 `app.notion.com`、`www.notion.so` 和 `notion.so`，只在
顶层页面运行，不匹配 `www.notion.com` 官网或 `*.notion.site` 发布站点。
脚本使用 `document-end` 和 ScriptCat 的 `@inject-into content` 模式，DOM 加载完成后
运行，后续 SPA 内容变化由现有 `MutationObserver` 处理。唯一申请的 GM 权限是
`GM_registerMenuCommand`，用于添加“暂时停用当前页（刷新恢复）”菜单；停用会清理
样式、快捷键与观察器，不删除缩放偏好。要长期停用，请在 ScriptCat 中禁用脚本并刷新。
这些元信息的行为以 [ScriptCat 官方文档](https://docs.scriptcat.org/docs/dev/meta/) 为准。

### 修改与发布更新

继续只编辑 `assets/notion-custom.css` 和 `assets/renderer-inject.js`，不要修改生成文件。
每次发布浏览器更新：

1. 递增 `package.json` 的三段数字版本（例如 `0.1.0` → `0.1.1`）。
2. 运行 `npm run build:userscript`，生成包含新版本的安装文件。
3. 运行 `npm test`，验证源码、版本和发布产物一致。
4. 将源文件、`package.json` 与 `userscripts/notion-restyle.user.js` 一起提交并推送到 `master`。
5. 在 ScriptCat 中检查更新并刷新 Notion；扩展的定时更新检查按其自身设置执行。

`npm test` 会先运行只读的 `npm run check:userscript`。如果产物缺失或与当前源码、
版本、默认更新地址不一致，检查会失败并提示重新构建，不会自动覆盖文件。
这防止只提交源码而遗漏安装文件；版本号仍需在每次发布时主动递增。

只在本地试用修改时，可重新构建并手动替换 ScriptCat 中的脚本，无需推送。
**当前不提供浏览器本地热更新**；桌面版已有的 CSS 热更新不受影响。

默认 `@version` 使用 `package.json` 的版本，默认更新地址指向本仓库。若要发布到
fork 或其他 HTTPS 地址，仍可显式覆盖版本与更新地址：

```bash
npm run build:userscript -- --version 0.1.1 --update-url https://example.com/notion-restyle.user.js
```

上面的地址仅为占位示例，必须替换成你实际发布 `.user.js` 的地址。覆盖参数只适用于
该次构建；fork 应同时修改构建脚本中的默认地址、README 安装链接及相关测试，保证
一致性检查使用自己的发布配置。构建不会自动提交、推送或发布文件。

### 提 PR 时自动同步产物

本仓库的 `AGENTS.md` 要求 coding agent 在每次创建或更新 PR、提交之前执行：

```bash
npm run prepare:pr
```

该命令依次构建用户脚本并运行 `npm test`。Agent 随后审查生成文件的差异，将变化的
`userscripts/notion-restyle.user.js` 与本次源码一同显式加入提交，避免 PR 只带源码。
若 PR 改变浏览器脚本行为或生成代码，还须确保 `package.json` 版本高于 PR 目标分支；
同一个 PR 已经递增过版本时不重复递增，纯文档修改不要求版本或产物产生变化。

这是项目级的 agent 提 PR 规则，不是全局 Git hook 或 GitHub 自动提交任务。
手动使用 `gh pr create` 或网页提 PR 时，也应先执行上面的命令并提交生成文件。
命令本身不会暂存、提交或推送任何文件；遇到会混入或覆盖无关工作的情况应先停止。
`npm test` 仍保持只读检查，避免测试自动重建而掩盖漏提交产物的问题。

### 缩放与存储

浏览器版沿用下文的缩放快捷键、三个独立比例、布局修正和本地存储键。
比例存储在当前 Notion 页面来源的 `localStorage` 中，不通过 ScriptCat 云同步；
同一来源、同一浏览器配置文件的标签页共享偏好。不同来源（例如 `www.notion.so`
与 `app.notion.com`）、不同浏览器配置文件，以及桌面版与浏览器版之间不自动同步。

安装后建议检查正文、全屏 AI 和侧栏 AI 的缩放与刷新后持久化，以及 `Show changes`、
`Hide changes`、`Undo` 和 peek 表格的原生交互。如果快捷键被浏览器或系统优先占用，
需要先解除对应冲突；字体加载和 Notion 的浏览器 DOM 也需要在实际页面验证。

## 自定义样式

编辑 [`assets/notion-custom.css`](./assets/notion-custom.css)。Notion 已由 Notion
Restyle 启动时，保存后会自动热更新到现有标签页；新标签页和页面重载也会自动注入。

项目中的初始 CSS 是 `/Users/xupeng/.config/notion/custom.css` 的快照。后续运行只读取
项目内文件，不读取或修改 `~/.config/notion/custom.css`、`gist.json`、Gist 缓存或
旧 `notion-font-customizer` 的其他配置。

正文英文默认使用 `Oxanium`，加载失败时回退到 `Pridi`。中文字体使用两个按用途命名的
内部字体族：`NotionRestyleBodyCJK` 的 `300` 使用霞鹜文楷
Light，`400/500` 使用 Medium，超过 `500` 使用霞鹜臻楷；
`NotionRestyleHeadingCJK` 将 `400–700` 映射到仓耳云黑 W04–W07。本机需安装能以
`LXGWWenKai-Light`、`LXGWWenKai-Medium`、`LXGW ZhenKai GB`（或
`LXGWZhenKaiGB`，也支持旧版 `LXGW ZhenKai` / `LXGWZhenKai-Regular`）和
`TsangerYunHei-W04` 至 `TsangerYunHei-W07` 识别的字体；任一字体不可用时，浏览器会
继续按字体栈回退到 `Noto Sans SC`。页面标题英文和数字使用 Signika Bold，中文使用
仓耳云黑 W07，统一采用 `700` 字重。

代码块英文和数字使用本机安装的 `Cascadia Code NF`，启用连字；中文沿用正文的
文楷／臻楷字重映射。

左侧边栏只把英文和数字换成 `Oxanium`（回退 `Pridi`）；字体栈中不含任何自定义中文字体，
因此侧边栏里的中文继续使用系统默认中文字体，不会变成霞鹜文楷或仓耳云黑。侧边栏的字号、
字重和行高都保持 Notion 原样。

## 正文与 AI 对话缩放

Notion Restyle 可以分别缩放笔记正文和 AI 对话界面。正文缩放不改变普通页面标题、属性、
评论、侧边栏或顶部栏；popup Feed view 内的整张内容卡片与正文共享同一缩放比例，但
popup 外框、视图标签、工具栏和按钮保持不变，长内容的 `See More` 在放大后仍可用于查看
全文。右键 Agent 生成内容沿用正文的自定义字体和缩放比例，但使用稍小字号；整个 Agent
卡片使用主题自适应的淡背景，外框、头像及操作
按钮样式保持不变。标准分隔符保留整行交互区域，可见横线以 `100px` 基准宽度居中并随
正文缩放，视觉厚度固定为 `2px`、不随缩放变化。AI 对话缩放只作用于侧栏或全屏对话中的
历史消息，包括用户消息、AI 回复以及消息内的代码块、卡片和附件。标题、对话名称、输入区
和按钮保持不变；为保证 `Show changes`、`Hide changes` 和 `Undo` 等 Notion 原生交互
正常工作，EditReference 变更卡始终保持 `100%`；非默认 AI 对话缩放下，`Show changes`
和 `Hide changes` 的鼠标操作沿用同一卡片的原生容器动作，避免被误判为拖动，`Undo`
仍保持独立按钮交互。正文中的图片会随正文放大，但宽图达到正文可视边界后会自动等比收缩，
始终完整显示。

Center peek 和 side peek 中的简单表格只缩放内部内容，外层宽容器和页面侧边留白保持
Notion 原尺寸，避免放大后表格向正文左侧突出；宽表格继续使用原生横向滚动。

缩放快捷键：

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
npm run check:userscript
npm run doctor
```

doctor 只读检查项目文件、Shell/Node 语法、Node runtime 和 Notion 签名，不会重启
Notion。

## 当前版本边界

桌面注入仅支持当前官方 macOS Notion 和 `https://app.notion.com` renderer，不保留
旧域名或旧 Electron 版本的兼容分支；浏览器用户脚本另匹配上文列出的工作区域名。
Notion 改变页面域名、CDP 行为或 DOM 结构后，需要更新 target 校验、用户脚本匹配范围
或自定义选择器。浏览器生成与模拟 DOM 测试不能替代真实 ScriptCat／Notion 页面验证。
