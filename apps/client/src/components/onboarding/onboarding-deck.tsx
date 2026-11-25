import { useState } from "react"
import { SlidesModal, useIsMobile, type Slide } from "@kanban/ui-kit"
import { SelfhostSlide } from "./selfhost-slide"
import { CardViewSlide } from "./card-view-slide"
import { ONBOARDING_SEEN_KEY } from "./use-should-onboard"
import {
  WHATS_NEW_SEEN_KEY,
  WHATS_NEW_VERSION,
} from "../whats-new/whats-new-seen"
import { webKeyValue } from "@/lib/adapters/web-kv"
import intro from "./slides/intro.md?raw"
import feedback from "./slides/feedback.md?raw"
import signedIn from "./slides/signed-in.md?raw"
import members from "./slides/members.md?raw"
import cards from "./slides/cards.md?raw"
import organize from "./slides/organize.md?raw"

interface IProps {
  shouldShow: boolean
}

export function OnboardingDeck({ shouldShow }: IProps) {
  // Only the first value counts, so signing in mid-deck doesn't close it
  const [open, setOpen] = useState(shouldShow)
  const [isSignedIn, setIsSignedIn] = useState(false)
  const isMobile = useIsMobile()

  function close() {
    webKeyValue.set(ONBOARDING_SEEN_KEY, "1")
    webKeyValue.set(WHATS_NEW_SEEN_KEY, WHATS_NEW_VERSION)
    setOpen(false)
  }

  const signInSlide: Slide = (next) => (
    <SelfhostSlide
      onDone={() => {
        setIsSignedIn(true)
        next()
      }}
    />
  )

  const slides: Slide[] = [intro, cards]
  // Card view is ignored on mobile
  if (!isMobile) slides.push((next) => <CardViewSlide onDone={next} />)
  slides.push(organize)
  slides.push(members)
  slides.push(signInSlide)
  if (isSignedIn) slides.push(signedIn)
  slides.push(feedback)

  return (
    <SlidesModal
      slides={slides}
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
    />
  )
}
