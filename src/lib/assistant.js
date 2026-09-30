// Talks to the in-app assistant (supabase/functions/ai-assistant, surface
// "assistant"). The reply streams back as server-sent events, so the answer
// appears word by word instead of after a long wait:
//
//   { type: "text", text }          more of the answer
//   { type: "status", text }        what it is doing ("Looking in invoices"); "" clears it
//   { type: "chart", chart }        a chart to draw
//   { type: "link", path, label }   a button that opens a page
//   { type: "error", message }
//   { type: "done" }
//
// supabase.functions.invoke waits for the whole body, so this uses fetch.
import { supabase } from "./supabaseClient";

const FUNCTION_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/ai-assistant`;

export const askAssistant = async ({ schoolId, messages, media = [], signal, onEvent }) => {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Sign in to use the assistant.");

  const response = await fetch(FUNCTION_URL, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: process.env.REACT_APP_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ surface: "assistant", schoolId, messages, media }),
  });

  // Refusals before the stream starts (not signed in, limit reached, not
  // configured) come back as plain JSON with an error.
  if (!response.ok || !(response.headers.get("Content-Type") || "").includes("text/event-stream")) {
    let message = "The assistant could not answer just now.";
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      // Not JSON; keep the general message.
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)));
      } catch {
        // A malformed event is skipped rather than ending the answer.
      }
    }
  }
};
