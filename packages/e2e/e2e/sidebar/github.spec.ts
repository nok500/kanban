import { test, expect } from "@playwright/test"
import { openUserMenuItem } from "../helpers/sidebar"

// The settings entry is a plain external link — assert where it points and that
// it opens in a new tab, rather than actually navigating off to GitHub.
test.describe("GitHub link", () => {
  test("points at the repository and opens in a new tab", async ({ page }) => {
    await page.goto("/")
    await openUserMenuItem(page, "Settings")

    const link = page.getByRole("link", { name: "GitHub" })
    await expect(link).toHaveAttribute(
      "href",
      "https://github.com/nok500/kanban"
    )
    await expect(link).toHaveAttribute("target", "_blank")
    await expect(link).toHaveAttribute("rel", /noreferrer/)
  })
})
