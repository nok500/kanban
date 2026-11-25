import { test, expect, type Page } from "@playwright/test"
import {
  addCard,
  boardTitle,
  card,
  column,
  createBoard,
  menu,
  openBoardMenu,
  renameBoard,
  retitleCard,
} from "../helpers"

/** Creates a board and leaves it on its empty state, unlike `createBoard`. */
async function createEmptyBoard(page: Page): Promise<void> {
  await page.goto("/")
  await page.getByRole("button", { name: "Create a board" }).click()
  await page.waitForURL(/\/d\/board-/)
  await expect(
    page.getByText("This board is empty. How do you want to start?")
  ).toBeVisible()
}

test.describe("board empty state", () => {
  test("Empty gives the default (Job search) columns", async ({ page }) => {
    await createEmptyBoard(page)

    await page.getByRole("button", { name: "Empty", exact: true }).click()

    for (const name of ["JDs", "Analise", "Follow-up", "NAY", "Applied"]) {
      await expect(page.getByRole("group", { name })).toBeVisible()
    }
  })

  test("From template offers the built-in layouts", async ({ page }) => {
    await createEmptyBoard(page)

    await page.getByRole("button", { name: "From template" }).click()
    await page.getByRole("menuitem", { name: "Kanban" }).click()

    for (const name of ["Backlog", "In progress", "Done", "Rejected"]) {
      await expect(page.getByRole("group", { name })).toBeVisible()
    }
  })

  test("From template copies the template's columns and cards", async ({
    page,
  }) => {
    await createBoard(page)
    await renameBoard(page, "Untitled board", "Sprint")
    await addCard(page, "Applied")
    await retitleCard(page, "Untitled card", "Demo prep")
    await openBoardMenu(page)
    await menu(page, "Board actions")
      .getByRole("menuitem", { name: "Add to templates" })
      .click()

    await createEmptyBoard(page)
    await page.getByRole("button", { name: "From template" }).click()
    await page.getByRole("menuitem", { name: "Sprint" }).click()

    await expect(
      column(page, "Applied").locator(card(page, "Demo prep"))
    ).toBeVisible()
    await expect(boardTitle(page, "Untitled board")).toBeVisible()
  })
})
