# Notion AI 形象动画抑制设计

## 背景

当前 Notion 页面会同时运行大量 AI 形象 SVG 动画。实测所选小狗形象的动画名和目标元素 ID 都使用 `agent-acc-dog-*` 前缀；暂停这些动画后，Notion renderer 的 CPU 占用明显下降。macOS 的“减弱动态效果”已经开启，Notion 页面也能读到 `prefers-reduced-motion: reduce`，但仍继续播放这些动画。

用户需要保留所有 Notion 页面、AI 功能及加载状态，只禁止当前和其他可选 AI 形象的装饰性动画。

## 目标

- 禁止所有采用 Notion AI 形象命名空间的装饰动画，而非只处理小狗。
- 保留 `spin` 等加载指示器以及页面的正常交互。
- 对动态插入的新形象自动生效，不增加持续扫描或观察开销。
- 通过现有 `Restore.command` 移除注入样式后自动恢复原始动画。

## 非目标

- 不关闭、挂起或卸载任何 Notion 页面。
- 不全局禁止 Notion 的动画或过渡效果。
- 不修改用户已经设置的三个独立缩放级别。
- 不把该改动描述为解决全部 `WindowServer` 占用；它只移除已确认的 Notion AI 形象动画负载。

## 方案比较

### 方案一：按 AI 形象目标 ID 前缀覆盖 CSS（采用）

向 `assets/notion-custom.css` 添加：

```css
[id^="agent-acc-"] {
  animation: none !important;
}
```

优点：

- 从小狗专用的 `agent-acc-dog-*` 提升到形象共用的 `agent-acc-*` 命名空间。
- CSS 会自动应用到当前及后续动态插入的 SVG 元素。
- 不需要 JavaScript 扫描、定时器或额外的 `MutationObserver`。
- 删除注入样式即可恢复 Notion 原有动画，清理路径简单。

风险：

- 实施时检查了当前 Notion renderer 已加载的形象映射：`dog` 使用独立动态组件，其余 25 个内置形象使用静态 PNG。因此当前版本只有小狗产生持续的 `agent-acc-*` 附件动画。
- 如果 Notion 日后增加不采用 `agent-acc-*` 命名空间的动态形象，新动画会继续播放，但本规则不会误伤其他页面功能。

### 方案二：通过 Web Animations API 暂停匹配动画

使用 `document.getAnimations()` 找出 `animationName.startsWith("agent-acc-")` 的动画，并在页面变化后重复处理。

该方案能绕过目标元素 ID 的差异，但需要保存并恢复动画状态、接入动态 DOM 协调流程，还会增加运行时复杂度和观察开销，因此不采用。

### 方案三：CSS 与 Web Animations API 双重处理

该方案对未知 DOM 变体更有容错性，但会重复处理同一批动画，并扩大测试和清理范围。现有证据不足以证明需要双重机制，因此不采用。

## 详细设计

### 样式范围

规则只选择 ID 以 `agent-acc-` 开头的元素，并只覆盖 `animation`。不覆盖 `transition`，避免改变形象上可能存在但并不持续消耗资源的交互反馈。

不会添加以下宽泛规则：

- `* { animation: none; }`
- `[role="status"] { animation: none; }`
- 针对 `spin` 动画名的覆盖

因此普通加载转圈和其他页面动效不在本次改动范围内。

### 注入与恢复

规则跟随现有 `notion-custom.css` 注入，不改变 `renderer-inject.js` 的状态模型。动态出现的新 AI 形象由浏览器 CSS 匹配机制自动处理。

执行项目已有的恢复流程后，承载自定义 CSS 的样式节点被移除，Notion 原有动画规则重新生效，无需单独记录或恢复动画对象。

### 兼容性与失效方式

该规则依赖 Notion 当前的 `agent-acc-*` 命名约定。命名发生变化时，预期表现是新形象继续播放，而不是页面功能损坏。届时可重新检查动画名和目标 ID，再更新选择器。

当前 renderer 的形象组件把 `dog` 单独交给动画组件渲染，其他已知形象均通过普通 `<img>` 渲染；选择形象时的 300ms 位移过渡不属于持续动画，本设计保留该交互反馈。

## 测试与验收

### 自动测试

新增针对 `assets/notion-custom.css` 的测试，至少验证：

- 存在 `[id^="agent-acc-"]` 选择器。
- 该选择器设置 `animation: none !important`。
- 没有加入全局动画禁用或针对 `spin`、`[role="status"]` 的覆盖。

继续运行：

```bash
npm test
npm run doctor
node --check assets/renderer-inject.js
git diff --check
```

### 真实页面验收

应用改动后，通过当前 renderer 的形象映射和可逆 CSSOM A/B 确认：

1. 小狗的 46 个 SVG 目标保持可见，但 `document.getAnimations()` 中没有运行中的 `agent-acc-*` 动画。
2. 其他当前可选形象使用静态图片，不存在需要额外禁止的持续附件动画。
3. `spin` 加载动画仍可正常出现和播放。
4. 页面编辑、AI 对话、形象选择和三个独立缩放功能正常。
5. 在可见且获得焦点的 renderer 中记录开关规则前后的页面任务占用，只把可重复观察到的差异归因于本次改动。

## 回滚

删除新增 CSS 规则并重新应用 `notion-restyle` 即可回滚。无需迁移存储值，也不会遗留运行时状态。
