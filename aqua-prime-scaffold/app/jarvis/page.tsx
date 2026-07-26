import { AquaVoiceConsole } from "~~/components/AquaVoiceConsole"
import { EnsureForkNetwork } from "~~/components/EnsureForkNetwork"

export const metadata = {
  title: "Aqua Prime — holographic desk agent",
  description: "Say aqua wake up. Holographic desk intelligence for Prime Desk.",
}

export default function JarvisVoicePage() {
  return (
    <>
      <div className="fixed left-3 top-3 z-[80] max-w-sm">
        <EnsureForkNetwork />
      </div>
      <AquaVoiceConsole />
    </>
  )
}
