import { expect, test } from "vitest"
import { cn } from "./utils"

test("class 合并时保留条件样式并移除被覆盖的间距", () => {
  const classes = (enabled: boolean) => cn("px-2", enabled && "font-medium", "px-4")

  expect(classes(true)).toBe("font-medium px-4")
  expect(classes(false)).toBe("px-4")
})
