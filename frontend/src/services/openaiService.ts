export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function sendToOpenAI(
  messages: OpenAIMessage[],
  options: {
    apiUrl: string;
    apiKey: string;
    model: string;
    onStream?: (text: string) => void;
  }
): Promise<string> {
  const streaming = !!options.onStream;

  const response = await fetch(`${options.apiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages,
      stream: streaming,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  if (streaming && options.onStream) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let result = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
          try {
            const data = JSON.parse(trimmed.slice(6));
            const content = data.choices?.[0]?.delta?.content;
            if (content) {
              result += content;
              options.onStream!(result);
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    }

    return result;
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}
