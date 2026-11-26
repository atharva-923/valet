export async function fetchConfig() {
  const res = await fetch("/api/config");
  if (!res.ok) {
    throw new Error(`Configuration request failed (${res.status})`);
  }
  return res.json();
}

export async function streamChat({ messages, provider, signal, onDelta }) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, provider }),
    signal,
  });

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail) detail = data.detail;
    } catch {
      // ignore non-json error body
    }
    throw new Error(detail);
  }

  if (!res.body) {
    throw new Error("Empty response stream from server.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const rawEvent of events) {
      const lines = rawEvent.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        let parsed;
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        if (parsed.type === "delta" && typeof parsed.text === "string") {
          onDelta(parsed.text);
        } else if (parsed.type === "error") {
          throw new Error(parsed.message || "Provider returned an error.");
        } else if (parsed.type === "done") {
          return;
        }
      }
    }
  }
}
