# AI Project Guide

这个文件给 Codex / AI 编程助手看。后续改代码时优先参考这里，目标是保持项目小、清楚、可学习。

## AI 协作硬规则

- 不确定就先问，不要猜。涉及业务条件、账号来源、外部接口、页面状态、存储结构、执行策略、是否删除旧流程、是否新增依赖时，必须先向用户确认。
- 缺少必要条件时不要先实现。必须先说明缺什么、为什么影响判断、需要用户确认哪一点。
- 不知道的事情不要自己决定。可以读取代码、运行命令、查调用链来确认；确认不了就问用户。
- 发现需求有多种合理做法时，不直接选一个做。先列出 1-3 个可选方案和影响，等用户确认后再改。
- 改动范围大时，必须先问能不能拆成小范围实现。优先做能验证闭环的最小改动，再逐步扩展。
- 跨模块改动前必须先确认调用链，至少看清：侧边栏 UI -> 消息或函数入口 -> background runner -> integration / util -> storage / tab / page script。
- 不能因为旧文档这么写就照做。实际行为以当前代码为准；文档和代码不一致时，先读代码，再更新文档。
- 不删除已有可用流程，除非已经确认是旧代码、无引用代码，或用户明确要求删除。
- 新增依赖前必须说明用途、替代方案和为什么现有工具不够；能不用新依赖就不用。
- 涉及账号、密码、验证码、Cookie、Token、API Key、手机号订单等敏感信息时，不写入示例、不提交、不持久化到新位置。

## 开始改动前的确认清单

AI 在动代码前先快速过一遍：

1. 需求是否明确到可以执行？如果不明确，先问。
2. 是否会影响登录、注册、自动触发、接码、邮箱验证码、CPA 回填中的任一流程？如果会，先看完整链路。
3. 是否会改 `chrome.storage.local` 的 key、数据结构或兼容逻辑？如果会，先确认迁移和旧数据处理方式。
4. 是否会改变账号筛选、执行顺序、停止策略、重试策略或价格策略？如果会，先确认业务规则。
5. 是否可以先做小范围版本并验证？如果可以，优先小范围实现。
6. 是否需要运行构建或手动验证？修改代码后优先运行 `npm run build`；只改文档时说明未运行构建。

## 完成后的说明要求

每次改动完成后必须告诉用户：

- 改了哪些文件。
- 入口在哪里，用户从哪个页面或按钮能看到变化。
- 改动链路是什么，例如：`CodexRegisterPage` -> `runRegisterBatch` -> `createCodexRegisterRunner` -> `HeroSMS`。
- 如何验证，包含已运行的命令和结果；如果没运行，要说明原因。
- 如果有剩余风险、需要人工确认的场景或后续可拆的小步骤，也要说明。

## 项目概览

- 项目名称：FlowPilot。
- 项目类型：Chrome 浏览器扩展 / Plasmo extension。
- 开发环境：Windows。
- 前端：React 18 + TypeScript + Ant Design。
- 入口：`sidepanel.tsx`。
- 后台入口：`background.ts`。
- 使用范围：个人本地学习和使用，不按公开分发产品设计。
- 当前目标：在 Chrome 侧边栏里管理 Codex/OpenAI 账号登录和注册流程，配合 CPA 管理接口、邮箱验证码、HeroSMS 手机号验证、后台自动触发和执行日志，跑通本地自动化闭环。

## 当前功能范围

- 侧边栏包含两个功能页：
  - 登录流程：批量登录已有账号。
  - 注册流程：批量注册账号，并支持后台自动触发。
- 两个功能页复用同一套账号管理组件：
  - 添加、编辑、删除账号。
  - 多选账号。
  - 全选账号。
  - 调整账号顺序。
  - 标记账号完成状态、按状态筛选和重置执行状态。
- 账号字段：
  - 邮箱服务：`2925` 或 `163`。
  - 邮箱生成方式：注册流程里的 `163` 可使用 DuckDuckGo 生成或自定义邮箱。
  - 注册邮箱。
  - 邮箱账号 / 邮箱登录地址。
  - 密码。
  - 稳定账号 ID、执行进度、执行状态和最近状态消息。
- 登录页流程：
  - 通过 CPA 管理接口获取 OAuth URL。
  - 打开 OpenAI 授权页并清理旧会话。
  - 填写邮箱和密码。
  - 从邮箱读取验证码。
  - 确认 OAuth 授权。
  - 捕获 localhost callback。
  - 把 localhost callback 回填到 CPA 管理接口。
- 注册页流程：
  - 打开 ChatGPT 注册入口。
  - 准备注册邮箱。
  - 提交邮箱。
  - 从邮箱读取注册验证码。
  - 填写注册资料。
  - 通过 CPA 管理接口刷新 OAuth 并完成登录。
  - 使用 HeroSMS 完成手机号验证。
  - 把 callback 回填到 CPA 管理接口。
- 注册流程支持从手机号验证阶段继续；状态为 `needs_review` 的账号需要人工确认后再处理。
- 注册自动触发支持：
  - 间隔触发。
  - 每天固定时间触发。
  - 保存当前选中的账号范围。
  - 账号之间随机等待。
  - 后台任务锁，避免重复启动。
  - 测试触发和清理残留任务锁。
- HeroSMS 配置支持：
  - API Key。
  - 国家和运营商。
  - 价格上限。
  - 固定价格档位。
  - Mock 模式。
  - 买号前价格校验和实际成本校验。
- 运行设置支持执行期间保持唤醒。
- 侧边栏流程和后台注册任务共用一份执行日志，保存在 `chrome.storage.local`，最多保留 6000 条。
- 关闭或重新打开侧边栏后仍可查看执行日志，用户可以在侧边栏中手动清空。
- 账号、CPA 配置、HeroSMS 配置、注册自动触发配置、运行设置和后台任务锁保存到 `chrome.storage.local`。

## 精简原则

- 能复用已有组件和工具函数，就不要再写一套。
- 能用 TypeScript 类型表达清楚的，不额外写复杂运行时包装。
- 能用 Ant Design 组件完成的 UI，不手写重复样式。
- 不保留已被新流程替代的旧入口、旧消息类型和孤立文件。
- 不提前做公开分发、多人使用、复杂权限隔离和大架构抽象。
- 只在能降低理解成本时抽函数；为了“看起来通用”的抽象不要加。

## 主要文件

- `sidepanel.tsx`：侧边栏总入口，负责页面切换、顶部状态、运行设置和执行日志。
- `sidepanel.css`：侧边栏全局样式。
- `shared/account-state.ts`：账号类型、状态规范化、进度工具、自动触发配置和运行设置。
- `shared/flow-contracts.ts`：登录、注册和页面动作跨模块复用的响应类型契约。
- `shared/storage-keys.ts`：`chrome.storage.local` key 的唯一声明位置；修改 key 前必须确认迁移策略。
- `shared/runtime-messages.ts`：侧边栏与 background 的 runtime 消息名称、请求和响应类型契约。
- `shared/logging.ts`：UI 日志和 console 日志工具。
- `platform/chrome/storage.ts`：统一的 Chrome 本地存储 get/read/write/remove 适配层。
- `platform/chrome/runtime-messaging.ts`：统一的类型安全 runtime 消息发送和响应适配层。
- `sidepanel/account-management/`：登录页和注册页复用的账号列表、账号表单、账号状态 hook。
- `sidepanel/register-task/useRegisterTaskControl.ts`：注册自动触发配置、后台任务锁和启动/停止消息的侧边栏 Hook。
- `sidepanel/register-task/RegisterAutomationPanel.tsx`：注册自动触发的受控表单展示组件，不直接访问 storage 或 runtime。
- `sidepanel/register-task/RegisterTaskStatus.tsx`：残留任务锁提示和手机号阶段停止策略的展示组件。
- `sidepanel/components/DebugTabControl.tsx`：调试区域里复用的 tab 控制组件。
- `sidepanel/pages/CodexLoginPage.tsx`：登录页 UI、批量登录和登录调试步骤。
- `sidepanel/pages/CodexRegisterPage.tsx`：注册页 UI、注册调试步骤、自动触发配置入口和停止策略入口。
- `sidepanel/cpa-config/`：CPA 地址和管理密钥表单。
- `sidepanel/hero-sms-config/`：HeroSMS 接码配置、国家/运营商加载和 Mock 开关。
- `background.ts`：后台 service worker 模块启动入口。
- `background/app/side-panel.ts`：扩展图标点击时打开侧边栏。
- `background/app/power.ts`：执行期间保持唤醒相关逻辑。
- `background/login/steps.ts`：登录流程的后台步骤。
- `background/register/steps.ts`：注册流程的后台步骤。
- `background/register/batch-runner.ts`：注册批量执行器，供侧边栏手动执行和后台自动任务复用。
- `background/register/alarm.ts`：注册自动触发、任务锁、停止策略和后台消息处理。
- `background/register/phone-verification.ts`：HeroSMS 买号、价格校验、验证码轮询、手机号提交和订单状态处理。
- `background/integrations/cpa-management-api.ts`：CPA 管理接口。
- `background/integrations/mail-verification.ts`：邮箱验证码读取的统一入口。
- `background/integrations/mail-2925.ts`、`background/integrations/mail-2925-page-code.ts`：2925 邮箱登录和验证码读取。
- `background/integrations/mail-163.ts`、`background/integrations/mail-163-page-code.ts`：163 邮箱登录和验证码读取。
- `background/integrations/duck-email.ts`、`background/integrations/duck-email-page.ts`：DuckDuckGo 邮箱生成辅助逻辑。
- `background/page-scripts/page-script.ts`：注入页面的动作脚本。
- `background/utils/`：标签页、页面注入、会话清理、取消执行、运行上下文、验证码重试等小工具。
- `assets/`：扩展图标和静态资源。

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

只修改 Markdown 文档时可以不运行构建，但最终说明里要写明“仅文档变更，未运行构建”。

## 开发规则

- 优先保持 React + TypeScript + Plasmo + Ant Design。
- UI 以 Chrome 侧边栏为主，不做营销页。
- 页面文案和状态要偏业务可读，方便用户按流程排错。
- 不删除已有可用流程，除非明确确认是旧代码或无引用代码。
- 不提交真实账号、密码、验证码、Cookie、Token 或 API Key。
- 新增依赖前先说明用途；能不用新依赖就不用。
- 代码注释优先使用 JSDoc 格式，重点描述业务目的、参数和返回值。
- 注释服务于学习和维护，不写“把 a 赋值给 b”这种低价值注释。
- 改跨模块流程时，先确认调用链：UI -> background runner -> integration / util。
- 改 UI 时优先沿用现有 Ant Design 布局和 `sidepanel.css` 风格。
- 改账号模型时要同步检查账号表单、账号列表、存储规范化、登录页、注册页、自动触发配置。
- 改后台消息类型时要同步检查发送方、接收方、响应类型和错误提示。
- 改外部服务集成时要保留清晰错误信息，让调用方或用户决定是否重试。

## 登录/注册步骤拆分规则

- 每个步骤只完成自己的动作，不替前一步补偿，也不替后一步等待页面稳定。
- 每个步骤必须可以重复执行；重复执行时先基于当前 tab 或页面状态判断能不能做。
- 上一步只传下一步真正需要的最小信息，例如 tabId、验证码请求时间、callback URL、OAuth state。
- 如果没有明确说明某一步会触发多次跳转，不额外添加复杂跳转等待。
- 需要 DOM 或页面状态可操作时，由当前步骤自己等待和检测。
- 失败时暴露失败原因，让调用方或用户决定是否重试。
- 手机号已提交、验证码已提交、CPA 回填失败这类可能产生外部成本或人工状态的场景，优先进入 `needs_review` 或明确提示人工检查，不要自动重跑消耗资源。
- HeroSMS 相关逻辑必须保留价格上限校验、固定档位校验和实际成本校验，避免无上限买号。

## 存储与数据规则

- 账号、CPA 配置、HeroSMS 配置、注册自动触发配置、运行设置和任务锁保存在 `chrome.storage.local`。
- 执行日志保存在 `chrome.storage.local`，最多保留 6000 条，超过上限时淘汰最早的记录。
- 自动触发配置里的 `selectedEmails` 沿用旧字段名，但当前内容是账号 ID；改动时不要误当成邮箱。
- 账号选择和列表操作使用稳定账号 ID，不要再把邮箱当主键。
- 修改存储结构时必须考虑旧数据兼容、默认值和无效数据过滤。

## Windows 与编码规则

- 所有 Markdown、TypeScript、JavaScript、CSS、HTML 文件统一按 UTF-8 处理。
- PowerShell 读取中文文件时显式使用 `-Encoding UTF8`。
- 如果看到 `杩欎釜`、`姝ラ` 这类乱码，先怀疑读取编码错误。
- 对含中文文件做批量处理前，先读取少量内容确认编码正常。

## 安全边界

- 这是个人本地学习工具，不适合直接分发给其他用户。
- 本地保存密码和 API Key 是为了学习和跑通流程，后续认真使用时应考虑加密或清空能力。
- 执行日志会持久化到浏览器本地存储，因此日志不得主动写入密码、验证码、Cookie、Token、API Key 或完整手机号订单敏感信息。
- 侧边栏必须保留清空日志能力，方便用户主动清理本地执行记录。
- HeroSMS 相关逻辑必须保留价格上限校验，避免无上限买号。
- 不在文档、测试或示例里写真实服务密钥、验证码、手机号订单细节。
- 涉及 HeroSMS 下单、取消、重发、等待验证码的逻辑必须谨慎，避免重复消耗。

## 建议阅读顺序

1. `sidepanel.tsx`：理解侧边栏如何组织页面、运行设置和日志。
2. `shared/storage-keys.ts`：理解所有本地存储 key 和兼容边界。
3. `shared/runtime-messages.ts`：理解侧边栏与 background 之间的消息协议。
4. `shared/flow-contracts.ts`：理解登录、注册步骤之间传递的响应数据。
5. `shared/account-state.ts`：理解账号状态、进度模型、自动触发配置和运行设置。
6. `sidepanel/account-management/useAccountPageState.ts`：理解账号增删改查和本地保存。
7. `sidepanel/pages/CodexLoginPage.tsx`：理解登录页面如何发起批量流程。
8. `background/login/steps.ts`：理解登录流程每一步做什么。
9. `sidepanel/pages/CodexRegisterPage.tsx`：理解注册页面、HeroSMS 配置和执行前校验。
10. `sidepanel/register-task/useRegisterTaskControl.ts`：理解自动触发配置和后台任务状态如何同步到页面。
11. `sidepanel/register-task/RegisterAutomationPanel.tsx`：理解自动触发表单字段和页面事件。
12. `sidepanel/register-task/RegisterTaskStatus.tsx`：理解残留锁提示和停止策略选择。
13. `background/register/batch-runner.ts`：理解注册批量任务如何筛选账号、更新状态和处理中断。
14. `background/register/steps.ts`：理解注册流程每一步如何操作页面。
15. `background/register/phone-verification.ts`：理解 HeroSMS 价格、买号、验证码轮询和订单状态。
16. `background/register/alarm.ts`：理解后台自动触发、任务锁和消息处理。

## 协作者背景

- 用户是后端 Java 开发，对前端工程化、React 和 Chrome 扩展细节不算熟悉。
- 沟通时优先解释业务流程、数据流和页面行为，再展开代码细节。
- 需要明确说明“为什么这么改”和“从哪里进到哪里出”。
- 修改完成后优先说明：改了哪些文件、入口在哪里、改动链路、如何验证。
