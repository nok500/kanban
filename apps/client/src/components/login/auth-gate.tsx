import { hasSignedIn, useAuthRequired, useSession } from "@kanban/core"
import { SignInPage } from "./sign-in-page"

/** On the web, a server with ALWAYS_AUTH shows a signed-out visitor only the
 * sign-in page. Unreachable or offline, it lets the local app through. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const authRequired = useAuthRequired()
  const session = useSession()

  // A device that signed in before skips the wait
  const loading = authRequired.isLoading || session.isLoading
  if (loading && !hasSignedIn()) return null

  if (authRequired.data === true && session.data?.authed === false) {
    return <SignInPage />
  }

  return children
}
