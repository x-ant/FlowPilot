/**
 * 在 ChatGPT 注册资料页填写姓名和年龄/生日，并提交创建账户表单。
 *
 * 这个函数会被注入到目标页面执行，所以只使用页面上下文里的 DOM API。
 *
 * @param fullName 要填写到名称输入框的默认姓名。
 * @param age 用来推算生日年份的年龄。
 * @return 页面填写和提交结果。
 */
export const submitRegisterProfileInPage = (
  fullName: string,
  age: number
): Promise<{ ok: boolean; message: string }> => {
  /**
   * 在页面上下文里等待一小段时间。
   *
   * @param timeoutMs 等待毫秒数。
   * @return 等待完成的 Promise。
   */
  const waitForDelay = (timeoutMs: number) => {
    return new Promise<void>((resolve) => {
      window.setTimeout(resolve, timeoutMs)
    })
  }

  /**
   * 统一页面文案，方便和中文/英文按钮文本做宽松匹配。
   *
   * @param value 原始页面文本。
   * @return 去空白并小写后的文本。
   */
  function normalizeText(value: string) {
    return String(value || "")
      .replace(/\s+/g, "")
      .toLowerCase()
  }

  /**
   * 读取元素上的可见文本和辅助属性文本。
   *
   * @param element 要识别的页面元素。
   * @return 规范化后的元素文本。
   */
  const getElementText = (element: Element) => {
    const inputValue = element instanceof HTMLInputElement ? element.value : ""

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
   * 判断元素是否不可见、禁用或不可点击。
   *
   * @param element 要检查的页面元素。
   * @return 不可操作时返回 true。
   */
  const isUnavailable = (element: Element) => {
    const htmlElement = element as HTMLElement
    const rect = htmlElement.getBoundingClientRect()
    const style = window.getComputedStyle(htmlElement)

    return (
      rect.width <= 0 ||
      rect.height <= 0 ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      Boolean((element as HTMLButtonElement).disabled) ||
      htmlElement.getAttribute("aria-disabled") === "true"
    )
  }

  /**
   * 轮询等待页面上出现目标元素或状态。
   *
   * @param getter 每次轮询执行的查找函数。
   * @param timeoutMs 最长等待时间。
   * @return 找到的值；超时返回 undefined。
   */
  const waitFor = async <T>(
    getter: () => T | undefined | Promise<T | undefined>,
    timeoutMs: number
  ) => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const value = await getter()
      if (value) {
        return value
      }

      await waitForDelay(200)
    }

    return undefined
  }

  /**
   * 按选择器列表查找第一个可操作输入控件。
   *
   * @param selectors 候选 CSS 选择器。
   * @return 找到的输入控件；找不到返回 undefined。
   */
  const findInput = (selectors: string[]) => {
    for (const selector of selectors) {
      const matched = Array.from(document.querySelectorAll(selector)).find(
        (element) => {
          return !isUnavailable(element)
        }
      ) as HTMLElement | undefined

      if (matched) {
        return matched
      }
    }

    return undefined
  }

  /**
   * 按上下文语义查找第一个可操作输入控件。
   *
   * @param predicate 字段语义判断函数。
   * @return 命中的输入控件；找不到返回 undefined。
   */
  const findInputByContext = (predicate: (element: Element) => boolean) => {
    return Array.from(
      document.querySelectorAll("input,[role='spinbutton']")
    ).find((element) => {
      return !isUnavailable(element) && predicate(element)
    }) as HTMLElement | undefined
  }

  /**
   * 用原生 setter 写入 input/select 的值，并派发 React 能感知的事件。
   *
   * @param input 要写入的输入框或下拉框。
   * @param value 要写入的值。
   */
  const setInputValue = (
    input: HTMLInputElement | HTMLSelectElement,
    value: string
  ) => {
    if (input instanceof HTMLSelectElement) {
      const optionValues = [
        value,
        String(Number(value)),
        value.padStart(2, "0")
      ]
      const option = Array.from(input.options).find((item) => {
        return (
          optionValues.includes(item.value) ||
          optionValues.includes(normalizeText(item.textContent || ""))
        )
      })

      input.value = option?.value || value
      if (option) {
        option.selected = true
      }
    } else {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set

      if (valueSetter) {
        valueSetter.call(input, value)
      } else {
        input.value = value
      }
    }

    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }

  /**
   * 填写普通输入框、下拉框或 contenteditable 风格字段。
   *
   * @param element 要填写的页面元素。
   * @param value 要写入的值。
   */
  const fillField = async (element: HTMLElement, value: string) => {
    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement
    ) {
      setInputValue(element, value)
      element.focus()
      return
    }

    element.focus()
    document.execCommand("selectAll", false)

    for (const character of value) {
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: character,
          bubbles: true
        })
      )
      element.dispatchEvent(
        new InputEvent("beforeinput", {
          inputType: "insertText",
          data: character,
          bubbles: true
        })
      )
      element.dispatchEvent(
        new InputEvent("input", {
          inputType: "insertText",
          data: character,
          bubbles: true
        })
      )
      element.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: character,
          bubbles: true
        })
      )
      await waitForDelay(30)
    }

    element.textContent = value
    element.blur()
  }

  /**
   * 查找 React Aria Select 结构里的隐藏原生 select。
   *
   * @param labels 年/月/日等候选标签。
   * @return 匹配到的隐藏 select。
   */
  const findBirthdaySelect = (labels: string[]) => {
    const normalizedLabels = labels.map(normalizeText)

    return Array.from(document.querySelectorAll(".react-aria-Select"))
      .map((root) => {
        const hasLabel = Array.from(root.querySelectorAll("span")).some(
          (span) => {
            return normalizedLabels.includes(
              normalizeText(span.textContent || "")
            )
          }
        )
        const item = root.closest("[class*='selectItem']") || root.parentElement

        return hasLabel
          ? (item?.querySelector(
              '[data-testid="hidden-select-container"] select'
            ) as HTMLSelectElement | null)
          : null
      })
      .find(Boolean) as HTMLSelectElement | undefined
  }

  /**
   * 根据默认年龄推算可填写的生日值。
   *
   * @return 年、月、日和完整日期字符串。
   */
  const getBirthdayFromAge = () => {
    const year = String(
      new Date().getFullYear() - Math.floor(Number(age) || 20)
    )

    return {
      year,
      month: "01",
      day: "01",
      value: `${year}-01-01`
    }
  }

  /**
   * 读取输入框附近的上下文文案。
   *
   * OpenAI 的“出生年份”单字段页面没有稳定 name，但字段外层 label 会出现
   * “出生年份/你出生于哪一年”等文案；用附近文案区分它和普通年龄字段。
   *
   * @param element 要识别的输入控件。
   * @return 规范化后的字段上下文。
   */
  const getFieldContextText = (element: Element) => {
    /**
     * 读取 aria 关联标签文本，避免只靠父级 DOM 时漏掉无包裹 label 的字段。
     *
     * @param attributeName aria-labelledby 或 aria-describedby。
     * @return 关联元素的合并文本。
     */
    const getReferencedText = (attributeName: string) => {
      return String(element.getAttribute(attributeName) || "")
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .filter(Boolean)
        .join(" ")
    }
    const contextNodes = [
      element,
      element.closest("label"),
      element.closest("fieldset"),
      element.parentElement,
      element.parentElement?.parentElement,
      element.parentElement?.parentElement?.parentElement
    ]

    return normalizeText(
      [
        getReferencedText("aria-labelledby"),
        getReferencedText("aria-describedby"),
        ...contextNodes.map((node) => {
          return [
            node?.textContent,
            node?.getAttribute?.("aria-label"),
            node?.getAttribute?.("title")
          ]
            .filter(Boolean)
            .join(" ")
        })
      ]
        .filter(Boolean)
        .join(" ")
    )
  }

  /**
   * 判断输入框是否是“出生年份”单字段。
   *
   * @param element 候选输入控件。
   * @return 命中出生年份语义时返回 true。
   */
  const isBirthYearInput = (element: Element) => {
    const text = getFieldContextText(element)
    return /出生年份|出生年|出生于哪一年|哪一年|yearofbirth|birthyear|bornyear/.test(
      text
    )
  }

  /**
   * 判断输入框是否是“年龄”单字段。
   *
   * @param element 候选输入控件。
   * @return 命中年龄语义时返回 true。
   */
  const isAgeInput = (element: Element) => {
    const text = getFieldContextText(element)
    return (
      !isBirthYearInput(element) && /年龄|你的年龄是多少|howold|age/.test(text)
    )
  }

  /**
   * 兼容多种生日字段结构，优先填写显式年月日，其次写隐藏 birthday 字段。
   *
   * @return 成功填写的字段类型描述；找不到返回 undefined。
   */
  const fillBirthdayField = async () => {
    const birthday = getBirthdayFromAge()
    const hidden = document.querySelector(
      "input[name='birthday']"
    ) as HTMLInputElement | null
    const yearSelect = findBirthdaySelect(["年", "Year"])
    const monthSelect = findBirthdaySelect(["月", "Month"])
    const daySelect = findBirthdaySelect(["日", "天", "Day"])

    if (yearSelect && monthSelect && daySelect) {
      setInputValue(yearSelect, birthday.year)
      setInputValue(monthSelect, "1")
      setInputValue(daySelect, "1")
      return "生日下拉字段"
    }

    const year = findInput([
      "[role='spinbutton'][data-type='year']",
      "[role='spinbutton'][aria-label*='year' i]",
      "[role='spinbutton'][aria-label*='年']",
      "input[name='year']",
      "input[name*='birth' i]",
      "input[placeholder*='year' i]",
      "input[placeholder*='出生年份']",
      "input[placeholder*='出生年']",
      "input[placeholder*='哪一年']",
      "input[placeholder*='年']",
      "input[aria-label*='year' i]",
      "input[aria-label*='出生年份']",
      "input[aria-label*='出生年']",
      "input[aria-label*='哪一年']",
      "input[aria-label*='年']"
    ])
    const month = findInput([
      "[role='spinbutton'][data-type='month']",
      "[role='spinbutton'][aria-label*='month' i]",
      "[role='spinbutton'][aria-label*='月']",
      "input[name='month']",
      "input[placeholder*='month' i]",
      "input[placeholder*='月']",
      "input[aria-label*='month' i]",
      "input[aria-label*='月']"
    ])
    const day = findInput([
      "[role='spinbutton'][data-type='day']",
      "[role='spinbutton'][aria-label*='day' i]",
      "[role='spinbutton'][aria-label*='日']",
      "[role='spinbutton'][aria-label*='天']",
      "input[name='day']",
      "input[placeholder*='day' i]",
      "input[placeholder*='日']",
      "input[placeholder*='天']",
      "input[aria-label*='day' i]",
      "input[aria-label*='日']",
      "input[aria-label*='天']"
    ])

    if (year && month && day) {
      await fillField(year, birthday.year)
      await fillField(month, birthday.month)
      await fillField(day, birthday.day)
      if (hidden) {
        setInputValue(hidden, birthday.value)
      }
      return "生日输入字段"
    }

    if (year && isBirthYearInput(year)) {
      await fillField(year, birthday.year)
      if (hidden) {
        setInputValue(hidden, birthday.value)
      }
      return "出生年份字段"
    }

    if (hidden) {
      setInputValue(hidden, birthday.value)
      return "隐藏生日字段"
    }

    return undefined
  }

  /**
   * 查找资料页的创建账户/继续按钮。
   *
   * @return 可点击按钮元素。
   */
  const findButton = () =>
    Array.from(
      document.querySelectorAll(
        "button,[role='button'],input[type='button'],input[type='submit']"
      )
    ).find((element) => {
      const currentElementText = getElementText(element)
      return (
        !isUnavailable(element) &&
        /完成账户创建|完成帐户创建|创建账户|createaccount|createanaccount|finish|done|continue|继续/.test(
          currentElementText
        )
      )
    }) as HTMLElement | undefined

  /**
   * 获取按钮所在表单，供 requestSubmit 使用。
   *
   * @return 按钮和表单上下文。
   */
  const getButtonActionContext = () => {
    const button = findButton()
    const buttonForm =
      button instanceof HTMLButtonElement || button instanceof HTMLInputElement
        ? button.form
        : null
    const form: HTMLFormElement | null =
      buttonForm || (button?.closest("form") as HTMLFormElement | null) || null

    return {
      button,
      buttonForm,
      form
    }
  }

  /**
   * 触发表单提交，优先直接点击按钮，失败时退回 requestSubmit。
   *
   * @param button 要点击的按钮。
   * @param buttonForm 按钮原生 form 引用。
   * @param form 最近的表单元素。
   * @return 是否成功触发提交动作。
   */
  const performButtonAction = (
    button: HTMLElement | undefined,
    buttonForm: HTMLFormElement | null,
    form: HTMLFormElement | null
  ) => {
    const clickButton = () => {
      if (!button || typeof button.click !== "function") {
        return false
      }

      button.click()
      return true
    }

    const requestSubmit = () => {
      if (!form || typeof form.requestSubmit !== "function") {
        return false
      }

      if (buttonForm === form && button) {
        form.requestSubmit(button)
      } else {
        form.requestSubmit()
      }

      return true
    }

    return clickButton() || requestSubmit()
  }

  return (async () => {
    const nameInput = await waitFor(() => {
      return findInput([
        "input[name='name']",
        "input[autocomplete='name']",
        "input[placeholder*='全名']",
        "input[placeholder*='姓名']",
        "input[placeholder*='name' i]",
        "input[aria-label*='全名']",
        "input[aria-label*='姓名']",
        "input[aria-label*='name' i]"
      ])
    }, 10000)

    if (!nameInput) {
      return {
        ok: false,
        message: "未找到名称输入框"
      }
    }

    await fillField(nameInput, fullName)

    const profileMode = await waitFor(async () => {
      const ageInput = findInput([
        "input[name='age']",
        "input[placeholder*='年龄']",
        "input[placeholder*='age' i]",
        "input[aria-label*='年龄']",
        "input[aria-label*='age' i]"
      ])
      if (ageInput) {
        await fillField(ageInput, String(age))
        return "年龄字段"
      }

      const contextAgeInput = findInputByContext(isAgeInput)
      if (contextAgeInput) {
        await fillField(contextAgeInput, String(age))
        return "年龄字段"
      }

      const contextBirthYearInput = findInputByContext(isBirthYearInput)
      if (contextBirthYearInput) {
        await fillField(contextBirthYearInput, getBirthdayFromAge().year)
        return "出生年份字段"
      }

      const numberInput = findInput(["input[type='number']"])
      if (numberInput) {
        if (isBirthYearInput(numberInput)) {
          await fillField(numberInput, getBirthdayFromAge().year)
          return "出生年份字段"
        }

        if (isAgeInput(numberInput)) {
          await fillField(numberInput, String(age))
          return "年龄字段"
        }
      }

      return fillBirthdayField()
    }, 10000)

    if (!profileMode) {
      return {
        ok: false,
        message: "未找到年龄或生日输入项"
      }
    }

    const buttonActionContext = await waitFor(() => {
      const context = getButtonActionContext()
      return context.button ? context : undefined
    }, 5000)
    if (!buttonActionContext) {
      return {
        ok: false,
        message: "未找到完成账户创建按钮"
      }
    }

    if (
      !performButtonAction(
        buttonActionContext.button,
        buttonActionContext.buttonForm,
        buttonActionContext.form
      )
    ) {
      return {
        ok: false,
        message: "未能触发完成账户创建按钮"
      }
    }

    return {
      ok: true,
      message: `已填写 ${fullName} 和${profileMode}并点击完成账户创建`
    }
  })()
}
