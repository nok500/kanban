import { useRoute } from "wouter"
import { routes } from "@/lib/routes"

/** False on the standalone sign-in page, which hosts no app chrome. */
export function useIsMainWindow(): boolean {
  const [isSignIn] = useRoute(routes.signIn())
  return !isSignIn
}
