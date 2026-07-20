# FlowPilot

FlowPilot 是一个基于 Plasmo 的 Chrome 扩展，用 Chrome 侧边栏管理账号登录、注册、验证码读取、手机号验证和执行日志。

这个项目主要用于个人本地学习和流程验证，不按公开分发产品设计。

## 项目定位

- 本地学习项目，方便理解 React、TypeScript、Plasmo 和 Chrome 扩展自动化。
- 个人使用工具，重点是跑通账号登录和注册流程。
- 以 Chrome 侧边栏为主要交互入口。
- 使用 React 18、TypeScript、Plasmo 和 Ant Design。

## 当前功能

- 批量管理登录账号和注册账号。
- 保存 CPA 管理接口配置。
- 通过 2925 邮箱读取 OpenAI/Codex 验证码。
- 通过 HeroSMS 完成注册阶段的手机号验证。
- 支持登录流程和注册流程的单步调试。
- 支持注册任务后台自动触发。
- 在侧边栏内展示当前执行状态和持久化执行日志。

## 开发命令

```bash
npm run dev
npm run build
npm run package
```

修改代码后优先运行：

```bash
npm run build
```

## 主要入口

- `sidepanel.tsx`：Chrome 侧边栏主界面。
- `sidepanel/`：侧边栏页面、配置表单和账号管理组件。
- `background/`：登录、注册、验证码读取、手机号验证和后台任务逻辑。
- `platform/chrome/`：Chrome API 适配层，当前包含统一的本地存储访问方法。
- `shared/`：账号状态、Storage Key、日志和共享类型。
- `assets/`：扩展图标和静态资源。

## 使用提醒

- 项目会把账号、密码、CPA 配置和 HeroSMS 配置保存到 `chrome.storage.local`。
- 不要把真实账号、密码、验证码、Cookie、Token 或 API Key 提交到 GitHub。
- 执行日志保存在 `chrome.storage.local`，关闭或重新打开侧边栏后仍可查看，最多保留 6000 条。
- 日志可以在侧边栏中手动清空；日志内容不得主动记录密码、验证码、Cookie、Token 或 API Key。
- HeroSMS 买号逻辑必须保留价格上限校验，避免无上限消耗。
- 文档和代码里的中文内容统一按 UTF-8 处理。
