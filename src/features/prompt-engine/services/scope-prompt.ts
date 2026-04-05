/**
 * Prompt generation via Scope's multimodal pipeline.
 * Sends a webcam frame to Scope for analysis and returns a descriptive video prompt.
 *
 * This uses the Scope data channel to request prompt analysis from the active pipeline.
 * The pipeline must support multimodal input (vision) for this to work.
 */

/**
 * Request a prompt from Scope by sending an analysis instruction via the data channel.
 * Returns the generated prompt text.
 *
 * Note: This is a simplified flow. The actual implementation depends on how Scope
 * exposes multimodal analysis -- it may use a separate REST endpoint or a special
 * data channel message type. For MVP, we send the instruction as a prompt update
 * with a system-level analysis request.
 */
export async function generatePromptFromScope(
  dataChannel: RTCDataChannel,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (dataChannel.readyState !== 'open') {
      reject(new Error('Scope data channel is not open'));
      return;
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Scope prompt generation timed out (10s)'));
    }, 10_000);

    function cleanup() {
      clearTimeout(timeout);
      dataChannel.removeEventListener('message', handleMessage);
    }

    function handleMessage(event: MessageEvent) {
      try {
        const data = JSON.parse(event.data as string) as Record<string, unknown>;
        if (data.type === 'prompt_analysis' && typeof data.prompt === 'string') {
          cleanup();
          resolve(data.prompt);
        }
      } catch {
        // Not a JSON message or not a prompt response; ignore
      }
    }

    dataChannel.addEventListener('message', handleMessage);

    // Send analysis request
    dataChannel.send(
      JSON.stringify({
        type: 'analyze_frame',
        instruction:
          'You are a master video director. Analyze the current input frame and generate ' +
          'a highly descriptive, comma-separated text prompt for a generative AI video pipeline. ' +
          'Focus on lighting, subject matter, mood, camera angle, and artistic style.',
      }),
    );
  });
}

/**
 * Fallback: generate a prompt by sending the frame to Scope's REST API.
 * Used when the data channel doesn't support prompt_analysis messages.
 */
export async function generatePromptFromScopeRest(
  scopeBaseUrl: string,
  frameBlob: Blob,
): Promise<string> {
  const formData = new FormData();
  formData.append('file', frameBlob, 'webcam_frame.jpg');
  formData.append(
    'instruction',
    'Analyze this image and generate a highly descriptive, comma-separated text prompt ' +
      'for a generative AI video pipeline. Focus on lighting, subject matter, mood, and style.',
  );

  const res = await fetch(`${scopeBaseUrl}/api/v1/analyze`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`Scope prompt analysis failed (${res.status})`);
  }

  const data = (await res.json()) as { prompt?: string; text?: string };
  return data.prompt ?? data.text ?? '';
}
