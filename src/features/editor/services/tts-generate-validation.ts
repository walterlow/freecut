export function validateTtsGenerateRequest({
  text,
  isSupported,
  unsupportedMessage,
}: {
  text: string
  isSupported: boolean
  unsupportedMessage: string
}): string {
  const trimmedText = text.trim()
  if (!trimmedText) {
    throw new Error('Enter some text to synthesize.')
  }

  if (!isSupported) {
    throw new Error(unsupportedMessage)
  }

  return trimmedText
}
