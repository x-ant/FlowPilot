# OpenAI Auth Flow URLs

本文记录 FlowPilot 当前登录/注册流程里用到的 OpenAI 授权页面地址。实际判断以代码为准；当 OpenAI 页面变化时，优先更新这里再同步检查 URL 判断工具。

## 注册流程

1. 打开 GPT 页面。

   - 地址：`https://chatgpt.com/`
   - 进入方式：注册流程 Step 1 打开 ChatGPT 首页。
   - 下一步：点击注册入口并提交邮箱。

2. 点击注册并提交邮箱。

   - 常规下一页：`https://auth.openai.com/email-verification`
   - 可选密码页：`https://auth.openai.com/create-account/password`
   - 说明：如果先出现创建密码页，需要填写注册密码后再进入邮箱验证码页。

3. 提交邮箱验证码。

   - 下一页：`https://auth.openai.com/about-you`
   - 说明：进入个人信息补充页。

4. 填写个人信息。

   - 下一页：`https://chatgpt.com/`
   - 说明：填写名称和年龄/生日/出生年份后回到已登录的 ChatGPT 首页。

5. 完成 OAuth 登录。

   - 进入方式：通过 CPA 管理接口获取 OAuth URL 并打开。
   - 如果已有 OpenAI 登录信息，通常进入：`https://auth.openai.com/choose-an-account`
   - 如果没有登录信息，先进入：`https://auth.openai.com/log-in`
   - 登录密码页可选：`https://auth.openai.com/log-in/password`
   - 登录邮箱验证码页：`https://auth.openai.com/email-verification`
   - 登录完成后需要重新获取 OAuth URL，再进入：`https://auth.openai.com/choose-an-account`
   - 选择账号后进入：`https://auth.openai.com/add-phone`

6. 手机号验证。

   - 填写手机号页：`https://auth.openai.com/add-phone`
   - 提交手机号后进入：`https://auth.openai.com/phone-verification`
   - 填写手机验证码后进入：`https://auth.openai.com/sign-in-with-chatgpt/codex/consent`

7. CPA 回填。
   - 在 OAuth 授权确认页点击继续后进入 callback 地址。
   - callback 示例：`http://localhost:1455/auth/callback?...`
   - 说明：拿到 callback 后回填给 CPA 管理接口。

## 登录流程

登录流程会清理旧登录信息。它实际类似“不需要手机号验证的注册流程 Step 5 到 Step 7”。

1. 打开登录页并填写邮箱。

   - 地址：`https://auth.openai.com/log-in`
   - 下一步：可能进入密码页或邮箱验证码页。

2. 可选密码页和邮箱验证码页。

   - 可选密码页：`https://auth.openai.com/log-in/password`
   - 邮箱验证码页：`https://auth.openai.com/email-verification`
   - 说明：没有密码页时会直接进入邮箱验证码页。

3. OAuth 授权确认页。

   - 地址：`https://auth.openai.com/sign-in-with-chatgpt/codex/consent`
   - 说明：点击继续完成授权。

4. CPA 回填。
   - 点击继续后进入 callback 地址。
   - callback 示例：`http://localhost:1455/auth/callback?...`
   - 说明：拿到 callback 后回填给 CPA 管理接口。
