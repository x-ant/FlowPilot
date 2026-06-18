import type { ClickPageButtonResult } from "./types"

/**
 * 在目标网页中按文案查找并点击按钮。
 *
 * 这个函数会被注入到目标网页里执行，因此只能使用页面环境里可用的 DOM API。
 * 函数内部的小工具函数需要留在函数体内，避免注入到网页后找不到外部闭包变量。
 *
 * @param buttonTexts 可接受的按钮文案列表
 * @param timeoutMs 最多等待按钮出现的时间，单位毫秒
 * @param successMessage 点击成功时返回给 background 的提示
 * @param failureMessage 找不到按钮时返回给 background 的提示
 * @return 点击结果和提示信息。
 */
export const clickPageButtonByTextsInPage = (
  buttonTexts: string[],
  timeoutMs: number,
  successMessage: string,
  failureMessage: string
): Promise<ClickPageButtonResult> => {
  return new Promise((resolve) => {
    const startedAt = Date.now()

    /**
     * 统一按钮文案格式，去掉空白并转小写，提升匹配命中率。
     *
     * @param value 原始按钮文案。
     * @return 规范化后的文案。
     */
    const normalizeText = (value: string) => {
      return value.replace(/\s+/g, "").toLowerCase()
    }

    const targetTexts = buttonTexts.map(normalizeText)
    const candidateSelector =
      "button,a,[role='button'],input[type='button'],input[type='submit']"

    /**
     * 在页面里尝试提取授权链接，方便 background 在需要时直接打开。
     *
     * @return 找到时返回授权链接，否则返回 undefined。
     */
    const findAuthUrl = () => {
      const authLink = document.querySelector(
        'a[href*="auth.openai.com/oauth/authorize"]'
      ) as HTMLAnchorElement | null

      if (authLink?.href) {
        return authLink.href
      }

      const pageText = document.body?.textContent || ""
      const match = pageText.match(
        /https:\/\/auth\.openai\.com\/oauth\/authorize\?[^\s"'<>]+/
      )

      return match?.[0]
    }

    /**
     * 读取按钮可见文案和辅助属性，兼容普通按钮、图标按钮和 input 按钮。
     *
     * @param element 页面上的候选元素。
     * @return 用于匹配的按钮文本。
     */
    const getElementText = (element: Element) => {
      const inputValue =
        element instanceof HTMLInputElement ? element.value : ""

      return normalizeText(
        [
          inputValue,
          element.textContent,
          element.getAttribute("aria-label"),
          element.getAttribute("title")
        ]
          .filter(Boolean)
          .join(" ")
      )
    }

    /**
     * 跳过明显不可点击的元素，避免误点禁用态按钮。
     *
     * @param element 页面上的候选元素。
     * @return 如果元素明显不可点击则返回 true。
     */
    const isUnavailable = (element: Element) => {
      const htmlElement = element as HTMLElement
      return (
        Boolean((element as HTMLButtonElement).disabled) ||
        htmlElement.getAttribute("aria-disabled") === "true" ||
        htmlElement.style.pointerEvents === "none"
      )
    }

    /**
     * 在候选元素里查找文案匹配的按钮。
     *
     * @return 匹配到的按钮元素；如果没有找到则返回 undefined。
     */
    const findButton = () => {
      return Array.from(document.querySelectorAll(candidateSelector)).find(
        (element) => {
          if (isUnavailable(element)) {
            return false
          }

          const text = getElementText(element)
          return targetTexts.some((targetText) => {
            return text.includes(targetText)
          })
        }
      ) as HTMLElement | undefined
    }

    /**
     * 找到按钮就点击，并把结果返回给 background。
     *
     * @return 如果已经找到并点击按钮，则返回 true；否则返回 false。
     */
    const tryClick = () => {
      const button = findButton()
      if (button) {
        const buttonText = [
          button.textContent,
          button.getAttribute("aria-label"),
          button.getAttribute("title")
        ]
          .filter(Boolean)
          .join(" ")
          .trim()

        button.click()
        resolve({
          ok: true,
          message: successMessage,
          buttonText,
          authUrl: findAuthUrl()
        })
        return true
      }

      return false
    }

    if (tryClick()) {
      return
    }

    /**
     * 页面可能是异步渲染的，所以用短轮询等待按钮出现。
     *
     * @return 无。
     */
    const intervalId = window.setInterval(() => {
      if (tryClick()) {
        clearInterval(intervalId)
        return
      }

      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(intervalId)
        resolve({
          ok: false,
          message: failureMessage
        })
      }
    }, 300)
  })
}
