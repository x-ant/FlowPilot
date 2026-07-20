# FlowPilot

FlowPilot 是一个基于 Plasmo 的 Chrome 扩展，用 Chrome 侧边栏管理账号登录、注册、验证码读取、手机号验证和执行日志。

这个项目主要用于个人本地学习和流程验证，不按公开分发产品设计。

## 项目定位

- 本地学习项目，方便理解 React、TypeScript、Plasmo 和 Chrome 扩展自动化。
- 个人使用工具，重点是跑通账号登录和注册流程。
- 以 Chrome 侧边栏为主要交互入口。
- 使用 React 18、TypeScript、Plasmo 和 Ant Design。

## 当前功能

- 批量管理登录账号和注册账号，使用稳定账号 ID 维护选择、顺序、进度和状态。
- 登录页和注册页可分别选择 CPA 或 Sub2API 作为 OAuth 接入来源。
- 支持通过 2925、163 邮箱读取 OpenAI/Codex 验证码；163 注册账号可使用 DuckDuckGo 生成邮箱。
- 通过 HeroSMS 完成注册阶段的手机号验证，包含价格上限、固定档位、实际成本校验和 Mock 模式。
- 支持登录和注册的批量执行、单步调试、停止处理，以及注册流程从手机号阶段继续。
- 支持注册任务按间隔或每天固定时间在后台自动触发。
- 侧边栏和后台任务共用持久化执行日志，并支持级别筛选和手动清空。

## 开发命令

```bash
npm run dev
npm run build
npm run package
npm test
npm run typecheck
```

修改代码后优先运行：

```bash
npm run build
```

## 主要入口

- `sidepanel.tsx`：Chrome 侧边栏主界面。
- `sidepanel/`：侧边栏页面、账号管理、OAuth/HeroSMS 配置、调试面板和注册任务控制。
- `background/`：登录/注册批量执行器、页面步骤、外部服务集成和后台任务运行控制。
- `platform/chrome/`：Chrome API 适配层，包含统一的本地存储和 runtime 消息访问方法。
- `shared/`：账号状态、OAuth/流程响应契约、Storage Key、runtime 消息契约和日志。
- `tests/`：不访问真实外部服务的单元测试和批量编排测试。
- `assets/`：扩展图标和静态资源。

## 使用提醒

- 项目会把账号、密码、OAuth 接入配置和 HeroSMS 配置保存到 `chrome.storage.local`。
- 不要把真实账号、密码、验证码、Cookie、Token 或 API Key 提交到 GitHub。
- 执行日志保存在 `chrome.storage.local`，关闭或重新打开侧边栏后仍可查看，最多保留 6000 条。
- 日志可以在侧边栏中手动清空；日志内容不得主动记录密码、验证码、Cookie、Token 或 API Key。
- HeroSMS 买号逻辑必须保留价格上限校验，避免无上限消耗。
- 文档和代码里的中文内容统一按 UTF-8 处理。
