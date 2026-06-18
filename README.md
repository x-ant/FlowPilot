# codex-login

这是一个基于 Plasmo 的 Chrome 扩展，目标是做一个个人本地使用的登录辅助工具。

## 项目定位

- 本地学习项目
- 个人使用
- Chrome 侧边栏为主
- 使用 React + TypeScript + Plasmo

## 主要功能

- 保存 Codex 登录地址
- 保存单个 2925 邮箱账号和密码
- 自动进入登录流程
- 自动填写邮箱、密码和验证码
- 显示执行状态、统计和日志

## 开发命令

```bash
npm run dev
npm run build
npm run package
```

## 入口文件

- `sidepanel.tsx`: 侧边栏主界面
- `background/`: 后台逻辑
- `assets/`: 图标和静态资源

## 说明

- 项目优先在本地使用，不考虑对外分发
- 文档和代码中如果涉及中文内容，统一按 UTF-8 处理
- 如果后续新增 SVG 资源，可以再考虑引入 `svgo` 一类的优化工具
