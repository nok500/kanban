import { useQuery } from "@tanstack/react-query"
import { activeStorage } from "@kanban/core"

const isUrl = (image: string) => /^(https?:\/\/|data:)/.test(image)

function resolve(key: string): Promise<string> {
  return activeStorage().url("avatar", key)
}

export function useAvatarUrl(image: string | null): string | null {
  const isKey = !!image && !isUrl(image)
  const { data } = useQuery({
    queryKey: ["avatar", image],
    queryFn: () => resolve(image!),
    enabled: isKey,
    staleTime: Infinity,
    gcTime: Infinity,
  })

  if (!image) return null
  return isKey ? (data ?? null) : image
}
