# AI Project Guide

这个文件给 Codex / AI 编程助手看。后续改代码时优先参考这里，目标是保持项目小、清楚、可学习。

## 项目概览

- 项目名称：FlowPilot。
- 项目类型：Chrome 浏览器扩展 / Plasmo extension。
- 开发环境：Windows。
- 前端：React 18 + TypeScript + Ant Design。
- 入口：`sidepanel.tsx`。
- 使用范围：个人本地学习和使用，不按公开分发产品设计。
- 当前目标：管理 Codex/OpenAI 账号登录和注册流程，配合 CPA 管理接口、2925 邮箱验证码、HeroSMS 手机号验证和执行日志，跑通本地自动化闭环。

## 当前功能范围

- 侧边栏包含两个功能页：
  - 登录流程：批量登录已有账号。
  - 注册流程：批量注册账号，并支持后台自动触发。
- 两个功能页复用同一套账号管理组件：
  - 添加、编辑、删除账号。
  - 多选账号。
  - 调整账号顺序。
  - 标记账号完成状态。
- 账号字段保持最小：
  - 邮箱。
  - 密码。
- 登录页流程：
  - 通过 CPA 管理接口获取 OAuth URL。
  - 打开 OpenAI 授权页。
  - 填写邮箱和密码。
  - 从 2925 邮箱读取验证码。
  - 确认 OAuth 授权。
  - 把 localhost callback 回填到 CPA 管理接口。
- 注册页流程：
  - 打开 ChatGPT 注册入口。
  - 提交邮箱。
  - 从 2925 邮箱读取注册验证码。
  - 填写注册资料。
  - 通过 CPA 管理接口刷新 OAuth。
  - 使用 HeroSMS 完成手机号验证。
  - 把 callback 回填到 CPA 管理接口。
- 执行日志只保存在当前侧边栏会话内，关闭侧边栏后重新开始。
- 账号、CPA 配置、HeroSMS 配置、注册自动触发配置保存到 `chrome.storage.local`。

## 精简原则

- 能复用已有组件和工具函数，就不要再写一套。
- 能用 TypeScript 类型表达清楚的，不额外写复杂运行时包装。
- 能用 Ant Design 组件完成的 UI，不手写重复样式。
- 不保留已被新流程替代的旧入口、旧消息类型和孤立文件。
- 不提前做公开分发、多人使用、复杂权限隔离和大架构抽象。
- 只在能降低理解成本时抽函数；为了“看起来通用”的抽象不要加。

## 主要文件

- `sidepanel.tsx`：侧边栏总入口，负责页面切换、顶部状态和执行日志。
- `sidepanel/shared.ts`：侧边栏共享类型、存储 key、账号规范化和进度工具。
- `sidepanel/account-management/`：登录页和注册页复用的账号列表、账号表单、账号状态 hook。
- `sidepanel/pages/CodexLoginPage.tsx`：登录页 UI、批量登录和登录调试步骤。
- `sidepanel/pages/CodexRegisterPage.tsx`：注册页 UI、注册调试步骤、自动触发配置入口。
- `sidepanel/cpa-config/`：CPA 地址和管理密钥表单。
- `sidepanel/hero-sms-config/`：HeroSMS 接码配置。
- `background/login/steps.ts`：登录流程的后台步骤。
- `background/register/steps.ts`：注册流程的后台步骤。
- `background/register/batch-runner.ts`：注册批量执行器，供后台自动任务复用。
- `background/register/alarm.ts`：注册自动触发、任务锁和后台消息处理。
- `background/integrations/mail-2925.ts`、`background/integrations/mail-2925-page-*`：2925 邮箱登录和验证码读取。
- `background/register/phone-verification.ts`：HeroSMS 买号、验证码轮询和手机号验证。
- `background/utils/`：标签页、页面注入、会话清理、取消执行等小工具。
- `shared/logging.ts`：UI 日志和 console 日志工具。

## 常用命令

```bash
npm run dev
npm run build
npm run package
```

修改后优先运行：

```bash
npm run build
```

## 开发规则

- 优先保持 React + TypeScript + Plasmo + Ant Design。
- UI 以 Chrome 侧边栏为主，不做营销页。
- 不删除已有可用流程，除非明确确认是旧代码或无引用代码。
- 不提交真实账号、密码、验证码、Cookie、Token 或 API Key。
- 新增依赖前先说明用途；能不用新依赖就不用。
- 代码注释优先使用 JSDoc 格式，重点描述业务目的、参数和返回值。
- 注释服务于学习和维护，不写“把 a 赋值给 b”这种低价值注释。
- 改跨模块流程时，先确认调用链：UI -> background runner -> 工具函数。

## 登录/注册步骤拆分规则

- 每个步骤只完成自己的动作，不替前一步补偿，也不替后一步等待页面稳定。
- 每个步骤必须可以重复执行；重复执行时先基于当前 tab 或页面状态判断能不能做。
- 上一步只传下一步真正需要的最小信息，例如 tabId、验证码请求时间、callback URL。
- 如果没有明确说明某一步会触发多次跳转，不额外添加复杂跳转等待。
- 需要 DOM 或页面状态可操作时，由当前步骤自己等待和检测。
- 失败时暴露失败原因，让调用方或用户决定是否重试。

## Windows 与编码规则

- 所有 Markdown、TypeScript、JavaScript、CSS、HTML 文件统一按 UTF-8 处理。
- PowerShell 读取中文文件时显式使用 `-Encoding UTF8`。
- 如果看到 `杩欎釜`、`姝ラ` 这类乱码，先怀疑读取编码错误。
- 对含中文文件做批量处理前，先读取少量内容确认编码正常。

## 安全边界

- 这是个人本地学习工具，不适合直接分发给其他用户。
- 本地保存密码和 API Key 是为了学习和跑通流程，后续认真使用时应考虑加密或清空能力。
- 日志不持久化，降低账号执行细节长期留存在浏览器存储里的风险。
- HeroSMS 相关逻辑必须保留价格上限校验，避免无上限买号。

## 建议阅读顺序

1. `sidepanel.tsx`：理解侧边栏如何组织页面和日志。
2. `sidepanel/shared.ts`：理解账号状态、存储 key 和进度模型。
3. `sidepanel/account-management/useAccountPageState.ts`：理解账号增删改查和本地保存。
4. `sidepanel/pages/CodexLoginPage.tsx`：理解登录页面如何发起批量流程。
5. `background/login/steps.ts`：理解登录流程每一步做什么。
6. `sidepanel/pages/CodexRegisterPage.tsx` 和 `background/register/batch-runner.ts`：理解注册页面和后台批量任务如何分工。

## 协作者背景

- 用户是后端 Java 开发，对前端工程化、React 和 Chrome 扩展细节不算熟悉。
- 沟通时优先解释业务流程、数据流和页面行为，再展开代码细节。
- 修改完成后优先说明：改了哪些文件、入口在哪里、如何验证。
