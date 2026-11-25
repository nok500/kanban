import { test, expect } from "@playwright/test"

// The theme toggle lives in the sidebar's user menu and names what it does.
test.describe("theme toggle", () => {
  test("switches the theme and persists it across reload", async ({ page }) => {
    await page.goto("/")
    await expect(page.locator("html")).toHaveClass("dark")

    await page.getByRole("button", { name: "User menu" }).click()
    await page.getByRole("menuitem", { name: "Switch to light theme" }).click()
    await expect(page.locator("html")).toHaveClass("light")
    await expect(
      page.getByRole("menuitem", { name: "Switch to dark theme" })
    ).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("theme")))
      .toBe("light")

    await page.reload()
    await expect(page.locator("html")).toHaveClass("light")
  })
})
