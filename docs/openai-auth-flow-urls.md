# OpenAI Auth Flow URL Map

本文档只整理当前用户已经确认过的关键 URL，用于后续排查注册、登录、手机号验证和 CPA 回填流程。

## 注册流程

| 步骤 | URL | 页面状态 | 怎么进入 | 可以跳转到哪里 |
| --- | --- | --- | --- | --- |
| 1. 创建密码，可选 | `https://auth.openai.com/create-account/password` | 注册邮箱提交后，OpenAI 要求设置账号密码。不是每次都会出现。 | 在 ChatGPT 注册入口填写注册邮箱并点击继续后，如果 OpenAI 要求设置密码，会进入此页。 | 设置密码并继续后进入 `https://auth.openai.com/email-verification`。如果 OpenAI 不要求密码，会跳过此页。 |
| 2. 邮箱验证码 | `https://auth.openai.com/email-verification` | 等待填写注册邮箱验证码。 | 注册邮箱提交后直接进入，或从创建密码页继续后进入。 | 验证码提交成功后进入 `https://auth.openai.com/about-you`；验证码错误时通常仍停留在当前页并显示错误。 |
| 3. 注册资料 | `https://auth.openai.com/about-you` | 填写名称、年龄、生日或出生年份，然后点击继续。 | 邮箱验证码提交成功后进入。 | 资料提交成功后进入 ChatGPT / OAuth 登录态准备过程，后续通过 CPA OAuth 进入账号选择页。 |
| 4. OAuth 账号选择 | `https://auth.openai.com/choose-an-account` | 选择当前注册完成的 OpenAI 账号。 | 完成账号创建后，通过 CPA 管理接口刷新 OAuth URL 并打开 OpenAI 授权页。 | 点击目标账号卡片后进入 `https://auth.openai.com/add-phone`；如果账号已登录且流程已越过选择页，可能直接到手机号页、授权确认页或 callback。 |
| 5. 手机号填写 | `https://auth.openai.com/add-phone` | 填写 HeroSMS 获取到的手机号并点击继续。 | 账号选择成功后进入，或手机号验证码超时后通过浏览器历史回退返回。 | 手机号提交成功后进入 `https://auth.openai.com/phone-verification`；手机号不可用时可能停留本页并显示错误。 |
| 6. 手机验证码 | `https://auth.openai.com/phone-verification` | 等待填写 HeroSMS 收到的短信验证码。 | 手机号提交成功后进入。 | 短信验证码成功后进入 `https://auth.openai.com/sign-in-with-chatgpt/codex/consent`；验证码超时后可能回退到 `https://auth.openai.com/add-phone` 换号；页面异常时可能仍显示此 URL 但 Chrome 判断为错误页。 |
| 7. Codex OAuth 授权确认 | `https://auth.openai.com/sign-in-with-chatgpt/codex/consent` | OpenAI/Codex 授权确认页，需要点击继续。 | 手机验证码通过后进入；部分账号如果不需要手机号验证，也可能从账号选择后直接进入。 | 点击继续后跳转到 localhost callback。 |
| 8. CPA callback | `http://localhost:1455/auth/callback?code=...&scope=...&state=...` | OpenAI 授权完成后带回 `code` 和 `state`，等待回填 CPA 管理接口。 | Codex OAuth 授权确认页点击继续后进入。 | 后台捕获 callback URL 后，调用 CPA 管理接口回填；回填成功后账号标记完成。 |

## 登录流程

| 步骤 | URL | 页面状态 | 怎么进入 | 可以跳转到哪里 |
| --- | --- | --- | --- | --- |
| 1. 登录邮箱 | `https://auth.openai.com/log-in` | 填写登录邮箱。 | 通过 CPA 管理接口获取 OAuth URL，并打开 OpenAI 授权页后进入。 | 填写邮箱后可能进入 `https://auth.openai.com/log-in/password`，也可能直接进入 `https://auth.openai.com/email-verification`。 |
| 2. 登录密码，可选 | `https://auth.openai.com/log-in/password` | 填写登录密码。不是每次都会出现。 | 登录邮箱提交后，如果 OpenAI 要求密码，会进入此页。 | 密码提交后进入 `https://auth.openai.com/email-verification`。 |
| 3. 邮箱验证码 | `https://auth.openai.com/email-verification` | 等待填写登录邮箱验证码。 | 登录邮箱提交后直接进入，或从登录密码页继续后进入。 | 验证码提交成功后进入 `https://auth.openai.com/sign-in-with-chatgpt/codex/consent`；验证码错误时通常仍停留在当前页并显示错误。 |
| 4. Codex OAuth 授权确认 | `https://auth.openai.com/sign-in-with-chatgpt/codex/consent` | OpenAI/Codex 授权确认页，需要点击继续。 | 登录邮箱验证码通过后进入。 | 点击继续后跳转到 localhost callback。 |
| 5. CPA callback | `http://localhost:1455/auth/callback?code=...&scope=...&state=...` | OpenAI 授权完成后带回 `code` 和 `state`，等待回填 CPA 管理接口。 | Codex OAuth 授权确认页点击继续后进入。 | 后台捕获 callback URL 后，调用 CPA 管理接口回填；回填成功后账号标记完成。 |

## URL 状态判断注意点

| 场景 | 判断方式 | 原因 |
| --- | --- | --- |
| 判断流程已经到哪个 OpenAI 页面 | 可以先看 `tab.url`。 | URL 能表达大致业务状态，例如邮箱验证码页、手机号页、授权确认页。 |
| 捕获 localhost callback | 只要 URL 包含有效 `code` 和 `state` 就可以捕获，不要求页面加载成功。 | 本地 callback 页面可能打不开，但 OAuth 参数已经在 URL 上。 |
| 准备点击页面按钮或读取 DOM | 不能只看 URL，还要等待页面元素可操作。 | React 页面可能 URL 已变化，但 DOM 还没有挂载。 |
| 手机号验证码超时后回退并准备继续买号 | 不能只看 `/add-phone` URL，还要确认 tab 稳定。 | 日志里出现过 `url=/add-phone`、`status=loading`、`pendingUrl=/phone-verification`，这时继续买号会浪费 HeroSMS 订单。 |

## 外部页面

| 服务 | URL | 用途 | 注意点 |
| --- | --- | --- | --- |
| 2925 邮箱登录页 | `https://2925.com/login/` | 判断 2925 邮箱是否未登录。 | 当前流程不负责自动登录；未登录时提示用户手动处理。 |
| 163 邮箱入口 | `https://mail.163.com/` | 打开 163 邮箱。 | 当前流程不负责自动登录；如果未登录，需要提示用户手动登录。 |
| 163 邮箱主页面 | `https://mail.163.com/js6/main.jsp...` | 163 登录后的主页面或收件箱页面。 | 地址可能带 sid、hash 和 mbox 参数；是否在收件箱不能只靠固定完整 URL 判断。 |
| DuckDuckGo 邮箱设置 | `https://duckduckgo.com/email/settings/autofill` | 生成 DuckDuckGo 转发邮箱。 | 后续如果 DuckDuckGo 登录态失效，会跳到 DuckDuckGo 登录相关页面。 |

