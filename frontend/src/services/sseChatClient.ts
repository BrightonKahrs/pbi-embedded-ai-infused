/**
 * Raw SSE client for AG-UI Protocol streaming.
 *
 * Ported from ag-ui-playground/frontend/src/utils/sse-client.ts. Pure
 * TypeScript — no React, no third-party deps. We use fetch() + a
 * ReadableStream reader so we can POST a JSON body (browser EventSource
 * only supports GET) and parse the `data:` lines ourselves.
 */

import type { AGUIEvent, AGUIRunRequest } from "../types/ag-ui";

export interface SSEClientOptions {
  onEvent: (event: AGUIEvent) => void;
  onError: (error: Error) => void;
  onComplete: () => void;
  signal?: AbortSignal;
}

/**
 * Send an AG-UI request to ``url`` and stream the response back as
 * a sequence of parsed AG-UI events.
 *
 * The wire format is a standard ``text/event-stream`` where each event
 * is a single ``data: <json>\n\n`` block. We support multi-line ``data:``
 * blocks too (RFC 6202 SSE allows them) by concatenating the chunks.
 */
export async function streamAgentResponse(
  url: string,
  request: AGUIRunRequest,
  options: SSEClientOptions
): Promise<void> {
  const { onEvent, onError, onComplete, signal } = options;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(request),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    onError(err instanceof Error ? err : new Error(String(err)));
    return;
  }

  if (!response.ok) {
    onError(new Error(`HTTP ${response.status}: ${response.statusText}`));
    return;
  }

  if (!response.body) {
    onError(new Error("Response body is null — SSE streaming not supported"));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleMessage = (message: string) => {
    if (!message.trim()) return;
    let dataContent = "";
    for (const line of message.split("\n")) {
      if (line.startsWith("data: ")) {
        dataContent += line.slice(6);
      } else if (line.startsWith("data:")) {
        dataContent += line.slice(5);
      }
      // Skip event:, id:, retry:, comments.
    }
    if (!dataContent) return;
    if (dataContent.trim() === "[DONE]") {
      onComplete();
      return;
    }
    try {
      const event = JSON.parse(dataContent) as AGUIEvent;
      onEvent(event);
    } catch {
      // Heartbeat / partial frame — silently ignore.
      // eslint-disable-next-line no-console
      console.warn("Failed to parse AG-UI event:", dataContent);
    }
  };

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const messages = buffer.split("\n\n");
      buffer = messages.pop() || "";

      for (const message of messages) {
        handleMessage(message);
      }
    }

    if (buffer.trim()) {
      handleMessage(buffer);
    }
    onComplete();
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}
