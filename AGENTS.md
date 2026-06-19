# AI Project Guide

这个文件是给 Codex / AI 编程助手看的项目说明。它记录项目背景、开发规则和安全边界，后续写代码时优先参考这里。

## 项目概览

- 项目名称：codex-login
- 项目类型：Chrome 浏览器扩展 / Plasmo extension
- 开发环境：Windows。
- 项目文件包含中文内容，读写文件时必须注意编码。
- 使用范围：仅供个人本地学习和使用，基本不考虑分发给其他用户。
- 主要目的：
  - 学习如何使用 AI 辅助完成一个真实前端/浏览器扩展项目。
  - 跑通“保存账号信息、打开目标登录页、自动填写登录表单、读取邮箱验证码、记录执行日志”的完整流程。
- 核心场景：
  - 用户有多个 OpenAI / Codex 相关账号。
  - 这些账号不常使用，可能出现登录状态失效。
  - 插件通过侧边栏维护账号和密码，并一键刷新或恢复登录状态。

## 当前功能范围

- 管理单个 2925 邮箱账号。
- 第一版只做一个账号表单，不做账号列表。
- 账号邮箱就是 2925 邮箱，同时也是 Codex 登录账号。
- 账号包含 2925 邮箱和密码。
- 从侧边栏输入框获取 Codex 登录地址。
- 第一版只处理表单里的当前账号。
- 自动打开或定位到 Codex 登录页面。
- 自动填写邮箱。
- 自动填写密码。
- 读取 2925 邮箱验证码。
- 自动填写邮箱验证码。
- 展示执行统计。
- 展示执行日志。

## 参考项目

本项目要实现的是 `D:\ProjectsUi\FlowPilot` 里的一个功能子集。后续实现时优先参考这些文件：

- `D:\ProjectsUi\FlowPilot\flows\openai\workflow.js`
  - 参考 OpenAI 登录流程的步骤定义。
  - 重点关注 `oauth-login`、`fetch-login-code`、`confirm-oauth` 等登录相关步骤。
- `D:\ProjectsUi\FlowPilot\flows\openai\content\openai-auth.js`
  - 参考登录页面 DOM 检测、邮箱/密码填写、验证码填写、登录成功页面判断、异常兼容逻辑。
- `D:\ProjectsUi\FlowPilot\flows\openai\background\steps\oauth-login.js`
  - 参考 OAuth 登录入口和登录页面恢复逻辑。
- `D:\ProjectsUi\FlowPilot\flows\openai\background\steps\fetch-login-code.js`
  - 参考获取登录验证码、判断验证码页面、处理验证码失败和恢复逻辑。
- `D:\ProjectsUi\FlowPilot\background\mail-2925-session.js`
  - 参考 2925 邮箱登录会话、cookie 清理、登录页恢复、账号选择和限流处理。
- `D:\ProjectsUi\FlowPilot\mail2925-utils.js`
  - 参考 2925 账号数据结构、账号规范化、导入格式和可用状态判断。
- `D:\ProjectsUi\FlowPilot\sidepanel\mail-2925-manager.js`
  - 参考 2925 邮箱账号在侧边栏里的新增、编辑、删除和选择交互。
- `D:\ProjectsUi\FlowPilot\sidepanel\sidepanel.js`
  - 参考侧边栏状态保存、自动运行入口和日志展示方式。

注意：不要直接把 FlowPilot 整个复杂流程搬过来。codex-login 第一版只抽取“登录地址输入 + 单个 2925 邮箱账号登录 + 2925 验证码 + 临时状态日志”所需的最小子集。

## 暂不明确的事项

- 登录成功后出现的特定页面细节，需要从 FlowPilot 逻辑里抽取。
- 2925 邮箱验证码读取和异常兼容逻辑，需要从 FlowPilot 里抽取子集。
- 登录流程中是否包含额外验证、人机验证、设备确认或频率限制，需要参考 FlowPilot 的兼容策略。
- 是否需要保存登录成功后的状态、cookie 或 token。

## 技术栈

- 框架：Plasmo
- 前端：React 18
- 语言：TypeScript
- 入口文件：`popup.tsx`
- 目标浏览器：Chrome
- 包管理器：当前项目有 `package-lock.json`，优先使用 npm。

## 常用命令

```bash
npm run dev
npm run build
npm run package
```

## 项目结构说明

- `popup.tsx`：当前插件弹窗主界面，后续可能改为侧边栏或增加侧边栏入口。
- `assets/`：图片、图标等静态资源。
- `package.json`：项目依赖和脚本。
- `README.md`：Plasmo 默认项目说明。
- `AGENTS.md`：AI 开发协作说明。
- `DESIGN.md`：界面风格说明。
- `FEATURES.md`：功能需求说明。

## 开发规则

- 优先保持现有技术栈，先用 React + TypeScript + Plasmo 跑通功能。
- 先做学习版和本地可用版，不提前设计复杂架构。
- 不要随意重构无关文件。
- 不要删除已有功能，除非明确要求。
- UI 以侧边栏为主，兼顾 Chrome 扩展环境的空间限制。
- 修改后优先运行 `npm run build` 检查是否能构建。
- 如果需要新增依赖，先说明用途。

## Windows 与编码规则

- 当前项目运行在 Windows 环境。
- 项目文档和代码里可能包含中文。
- 所有 Markdown、TypeScript、JavaScript、CSS、HTML 文件统一按 UTF-8 处理。
- 使用 PowerShell 读取中文文件时，优先显式指定 `-Encoding UTF8`，例如：

```powershell
Get-Content AGENTS.md -Encoding UTF8
```

- 写入或修改文件时必须保持 UTF-8，避免使用系统默认 ANSI/GBK 编码导致中文乱码。
- 如果看到类似 `杩欎釜`、`姝ラ` 这类乱码，要优先怀疑是读取编码错误，而不是文件内容本身错误。
- 对含中文的文件做批量处理前，先读取少量内容确认编码正常。

## 安全边界

- 文档和代码示例中不要写入真实账号、真实密码、真实验证码或真实密钥。
- 学习版允许先本地保存邮箱和密码，以跑通流程为第一目标。
- 第一版需要保存到浏览器本地，下次打开插件仍能看到账号和登录地址。
- 日志不需要保存到本地，每次打开插件重新开始。
- 优先使用 Chrome 扩展本地存储，例如 `chrome.storage.local`。
- 后续如果进入更认真使用阶段，应考虑：
  - 避免把敏感信息提交到 Git。
  - 为密码增加本地加密或至少提供清空数据功能。
  - 明确提醒这是个人本地工具，不适合多人分发。

## AI 工作偏好

- 如果需求不清楚，先根据常见产品体验做合理实现，再把假设写清楚。
- UI 改动完成后说明改了哪些文件。
- 需要用户补充业务信息时，分批提问。
- 代码实现保持专业、清晰、可维护，避免不必要的过度抽象。
- 优先采用符合 React / Plasmo 习惯的写法，保证组件结构、状态管理和交互逻辑易于理解。
- 方法、函数或较复杂的逻辑块应补充简短注释，优先使用 JavaDoc 风格，必要时写明 `@param`、`@return`、`@throws` 等字段。
- 涉及另一个项目的已有功能时，优先让用户提供项目路径或关键文件，再复用/参考已有实现。
- 当你准备拆分函数、增加抽象层、引入通用工具、或者把一段代码改成“更通用”时，先自己判断这次改动是否合理。
- 如果判断合理，就直接执行，并在结果里简要说明为什么这样做。
- 如果判断不合理，或者收益不明显但会增加理解成本，就先反馈给用户，等用户同意后再执行。

## 协作者背景

- 用户是后端 Java 开发，对前端工程化、React 和 Chrome 扩展细节不算熟悉。
- 与用户沟通时，优先解释业务流程、数据流和页面行为，再展开代码细节。
- 如果涉及前端术语、浏览器扩展概念或 React 写法，尽量用通俗表达，必要时补一句简短说明。
- 修改完成后，优先给出：改了哪些文件、入口在哪里、如何验证结果。
