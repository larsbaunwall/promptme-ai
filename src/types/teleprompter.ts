export interface TeleprompterState {
  text: string
  fontSize: number
  speed: number
  isPlaying: boolean
  scrollPosition: number
  mirrorVertical: boolean
  mirrorHorizontal: boolean
}

export interface TeleprompterControls {
  togglePlay: () => void
  updateSpeed: (speed: number) => void
  updateFontSize: (size: number) => void
  toggleMirrorVertical: () => void
  toggleMirrorHorizontal: () => void
  setText: (text: string) => void
}
