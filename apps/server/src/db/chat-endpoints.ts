import { randomUUID } from "node:crypto"
import { asc, eq } from "drizzle-orm"
import { getDB } from "./get-db"
import { chatEndpoints } from "./schema"

export interface StoredChatEndpoint {
  id: string
  name: string
  apiUrl: string
  uiUrl: string | null
  apiKey: string | null
}

const columns = {
  id: chatEndpoints.id,
  name: chatEndpoints.name,
  apiUrl: chatEndpoints.apiUrl,
  uiUrl: chatEndpoints.uiUrl,
  apiKey: chatEndpoints.apiKey,
}

export async function listChatEndpoints(): Promise<StoredChatEndpoint[]> {
  return getDB()
    .select(columns)
    .from(chatEndpoints)
    .orderBy(asc(chatEndpoints.createdAt))
}

export async function findChatEndpoint(
  id: string
): Promise<StoredChatEndpoint | undefined> {
  const [row] = await getDB()
    .select(columns)
    .from(chatEndpoints)
    .where(eq(chatEndpoints.id, id))
    .limit(1)
  return row
}

export async function insertChatEndpoint(
  values: Omit<StoredChatEndpoint, "id">
): Promise<StoredChatEndpoint> {
  const now = Date.now()
  const row = { id: randomUUID(), ...values }
  await getDB()
    .insert(chatEndpoints)
    .values({ ...row, createdAt: now, updatedAt: now })
  return row
}

export async function updateChatEndpoint(
  id: string,
  patch: Partial<Omit<StoredChatEndpoint, "id">>
): Promise<StoredChatEndpoint | undefined> {
  const [row] = await getDB()
    .update(chatEndpoints)
    .set({ ...patch, updatedAt: Date.now() })
    .where(eq(chatEndpoints.id, id))
    .returning(columns)
  return row
}

export async function deleteChatEndpoint(id: string): Promise<boolean> {
  const rows = await getDB()
    .delete(chatEndpoints)
    .where(eq(chatEndpoints.id, id))
    .returning({ id: chatEndpoints.id })
  return rows.length > 0
}
