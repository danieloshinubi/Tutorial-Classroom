import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Icon } from "react-icons-kit";
import { zap } from "react-icons-kit/feather/zap";
import { x as xIcon } from "react-icons-kit/feather/x";
import { plus } from "react-icons-kit/feather/plus";
import { send } from "react-icons-kit/feather/send";
import { paperclip } from "react-icons-kit/feather/paperclip";
import { file as fileIcon } from "react-icons-kit/feather/file";
import { square } from "react-icons-kit/feather/square";
import { arrowRight } from "react-icons-kit/feather/arrowRight";
import { useSchool } from "../../context/SchoolContext";
import { useAuth } from "../../context/AuthContext";
import { askAssistant } from "../../lib/assistant";
import Markdown from "./Markdown";
import Chart from "./Chart";
import { ACTIONS, describeParams, runAction } from "../../lib/assistantActions";

// A proposed action, waiting for the person: what it will do, and Confirm or
// Cancel. Nothing has happened until Confirm (see lib/assistantActions.js).
const ActionCard = ({ action, secret, onConfirm, onCancel, onOpen }) => {
  const def = ACTIONS[action.action];
  const details = describeParams(action.params);
  const questions = Array.isArray(action.params?.questions) ? action.params.questions : null;
  return (
    <div className={`ai-action is-${action.state}${def?.danger ? " is-danger" : ""}`}>
      <div className="ai-action-head">
        <span className="ai-action-kind">{def?.title || "Action"}</span>
        {action.state === "done" ? <span className="ai-action-badge done">{"Done"}</span> : null}
        {action.state === "failed" ? <span className="ai-action-badge failed">{"Didn't work"}</span> : null}
        {action.state === "cancelled" ? <span className="ai-action-badge">{"Cancelled"}</span> : null}
      </div>
      <p className="ai-action-summary">{action.summary}</p>
      {details.length ? (
        <dl className="ai-action-details">
          {details.slice(0, 8).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v.length > 220 ? `${v.slice(0, 219)}…` : v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {questions ? (
        <ol className="ai-action-questions">
          {questions.slice(0, 12).map((q, i) => (
            <li key={i}>
              {q.prompt}
              {Array.isArray(q.options) && q.options.length ? (
                <span className="ai-sub">{q.options.map((o) => `${o.correct ? "✓ " : ""}${o.text}`).join(" · ")}</span>
              ) : q.answer ? (
                <span className="ai-sub">{`Answer: ${q.answer}`}</span>
              ) : null}
            </li>
          ))}
          {questions.length > 12 ? <li className="ai-sub">{`and ${questions.length - 12} more`}</li> : null}
        </ol>
      ) : null}
      {!def ? <p className="ai-error">{"This isn't something the assistant is allowed to do."}</p> : null}
      {action.state === "waiting" && def ? (
        <div className="ai-action-buttons">
          <button type="button" className="ai-confirm" onClick={onConfirm}>{"Confirm"}</button>
          <button type="button" className="ai-cancel" onClick={onCancel}>{"Cancel"}</button>
        </div>
      ) : null}
      {action.state === "running" ? <p className="ai-status">{"Doing it…"}</p> : null}
      {action.state === "done" ? <p className="ai-action-result">{action.result}</p> : null}
      {action.state === "failed" ? <p className="ai-error">{action.result}</p> : null}
      {secret ? <p className="ai-action-secret">{secret}</p> : null}
      {action.state === "done" && action.link ? (
        <button type="button" className="ai-link" onClick={() => onOpen(action.link.path)}>
          {action.link.label}
          <Icon icon={arrowRight} size={14} />
        </button>
      ) : null}
    </div>
  );
};

// The in-app assistant: a button in the top bar and a panel that slides in
// from the right. It answers from the school's data as the signed-in person
// (see supabase/functions/ai-assistant), so everyone gets one, and each only
// ever sees what their own account can see.
//
// The conversation is kept for this tab (sessionStorage), per person and
// school, so moving between pages does not lose it; New chat clears it.
// Per PERSON matters: keyed by school alone, the next person to sign in on
// the same device saw the previous person’s questions and answers (found in
// testing: a parent saw a teacher’s "What’s my salary?"). Anyone else’s saved
// chat is also wiped the moment someone new is signed in.

const SUGGESTIONS = {
  owner: [
    "How much have we collected in fees this term, and how much is still owed?",
    "Which classes owe the most in fees? Show me a chart.",
    "How many pupils do we have in each level?",
    "What sold best in the store this month?",
  ],
  admin: [
    "How many pupils do we have in each class?",
    "Who joined the school in the last 30 days?",
    "Which applications are waiting for a decision?",
    "Show attendance for this week by class.",
  ],
  bursar: [
    "Who owes more than ₦50,000 this term?",
    "Total payments received each week this term, as a chart.",
    "Which bills are still drafts?",
    "How much discount have we given this term?",
  ],
  teacher: [
    "Which of my pupils were absent this week?",
    "Summarise the latest results for my class.",
    "What assignments are due this week?",
    "Help me write a note to parents about the mid-term test.",
  ],
  parent: [
    "How much do I still owe in school fees?",
    "How did my child do in the last results?",
    "What is the school's latest news?",
    "Has my child been absent this term?",
  ],
  student: [
    "What assignments do I have due?",
    "Explain photosynthesis simply.",
    "How were my last results?",
    "Make me a revision plan for next week.",
  ],
};

const PREFIX = "schoolivio.assistant.";
// Attached files: held in memory for this visit (never saved with the chat),
// named by a short ref ("file-1") the assistant uses in actions.
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const sizeLabel = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// A pasted screenshot arrives as "image.png"; give it a name worth keeping.
const nameFor = (file) => {
  if (file.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(file.name)) return file.name;
  const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(2, "0")}.${String(d.getSeconds()).padStart(2, "0")}`;
  return `Pasted image ${stamp}.${ext}`;
};

// What a vision model is shown: pictures shrunk to at most 1600px as JPEG,
// PDFs as they are if small enough. (The original file is what gets uploaded.)
const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
const forVision = async (file, ref) => {
  if (file.type === "application/pdf") {
    return file.size <= 4 * 1024 * 1024 ? { ref, media_type: "application/pdf", data: await toBase64(file) } : null;
  }
  if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ? { ref, media_type: "image/jpeg", data: await toBase64(blob) } : null;
  } catch {
    return null;
  }
};

const storageKey = (userId, schoolId) => `${PREFIX}${userId}.${schoolId}`;

// Removes every saved chat that is not this person’s.
const forgetOthers = (userId) => {
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = window.sessionStorage.key(i);
      if (key && key.startsWith(PREFIX) && !key.startsWith(`${PREFIX}${userId}.`)) window.sessionStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable: nothing was saved either.
  }
};

const loadChat = (userId, schoolId) => {
  if (!userId || !schoolId) return [];
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(storageKey(userId, schoolId)) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
};

const Assistant = () => {
  const { schoolId, school, role } = useSchool();
  const { user } = useAuth();
  const userId = user?.id || null;
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(() => loadChat(userId, schoolId));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const abortRef = useRef(null);
  // Shown on a card once, never saved with the chat or sent to the AI.
  const [secrets, setSecrets] = useState({});
  // Files attached in this visit, by ref, and the ones waiting to be sent.
  const filesRef = useRef(new Map());
  const fileCount = useRef(0);
  const fileInputRef = useRef(null);
  const [pending, setPending] = useState([]);
  const [dragging, setDragging] = useState(false);

  const addFiles = (list) => {
    const added = [];
    for (const raw of Array.from(list || [])) {
      if (!raw || !raw.size) continue;
      if (raw.size > MAX_FILE_BYTES) {
        added.push({ ref: null, name: raw.name, error: `${raw.name} is over 20 MB` });
        continue;
      }
      const name = nameFor(raw);
      const file = name === raw.name ? raw : new File([raw], name, { type: raw.type });
      fileCount.current += 1;
      const ref = `file-${fileCount.current}`;
      filesRef.current.set(ref, file);
      added.push({ ref, name, type: file.type || "file", size: file.size, url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
    }
    if (added.length) setPending((x) => [...x, ...added.filter((a) => a.ref)]);
    const tooBig = added.filter((a) => a.error);
    if (tooBig.length) setMessages((list) => [...list, { role: "assistant", content: "", error: tooBig.map((a) => a.error).join("; ") }]);
    inputRef.current?.focus();
  };

  const onPaste = (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length) {
      // A pasted picture is attached; any text on the clipboard still pastes.
      if (!e.clipboardData.getData("text")) e.preventDefault();
      addFiles(files);
    }
  };
  // The latest conversation, for handlers that finish after an await.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (userId) forgetOthers(userId);
    setMessages(loadChat(userId, schoolId));
  }, [userId, schoolId]);

  useEffect(() => {
    if (!schoolId || !userId || busy) return;
    try {
      const saved = messages.slice(-40).map((m) => (m.actions ? { ...m, actions: m.actions.map((a) => (a.state === "running" ? { ...a, state: "failed", result: "Interrupted before it finished. Check before trying again." } : a)) } : m));
      window.sessionStorage.setItem(storageKey(userId, schoolId), JSON.stringify(saved));
    } catch {
      // Not saved; the chat just won't survive a reload.
    }
  }, [messages, schoolId, userId, busy]);

  // Keep the newest words in view while the answer streams in.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const go = useCallback(
    (path) => {
      navigate(path);
      if (window.matchMedia("(max-width: 720px)").matches) setOpen(false);
    },
    [navigate]
  );

  const patchLast = (fn) =>
    setMessages((list) => {
      const next = list.slice();
      next[next.length - 1] = fn({ ...next[next.length - 1] });
      return next;
    });

  const ask = async (text, { note = false, base = null } = {}) => {
    const attached = note ? [] : pending;
    const typed = String(text || "").trim();
    if ((!typed && !attached.length) || busy || !schoolId) return;
    const question = [
      typed || "(See the attached file.)",
      ...attached.map((f) => `[Attached: ${f.ref} ${f.name} (${f.type}, ${sizeLabel(f.size)})]`),
    ].join("\n");
    if (!note) {
      setDraft("");
      setPending([]);
    }
    const media = (await Promise.all(attached.map((f) => forVision(filesRef.current.get(f.ref), f.ref)))).filter(Boolean);
    const history = [
      ...(base || messages),
      { role: "user", content: question, ...(note ? { note: true } : {}), ...(attached.length ? { files: attached, typed } : {}) },
    ];
    setMessages([...history, { role: "assistant", content: "", charts: [], links: [], pending: true }]);
    setBusy(true);
    setStatus("Thinking");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await askAssistant({
        schoolId,
        signal: controller.signal,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        media,
        onEvent: (event) => {
          if (event.type === "text") {
            setStatus("");
            patchLast((m) => ({ ...m, content: m.content + event.text }));
          } else if (event.type === "status") {
            setStatus(event.text || "");
          } else if (event.type === "chart") {
            patchLast((m) => ({ ...m, charts: [...(m.charts || []), event.chart] }));
          } else if (event.type === "action") {
            patchLast((m) => ({ ...m, actions: [...(m.actions || []), { id: event.id, action: event.action, params: event.params, summary: event.summary, state: "waiting" }] }));
          } else if (event.type === "link") {
            patchLast((m) => ({ ...m, links: [...(m.links || []), { path: event.path, label: event.label }] }));
          } else if (event.type === "error") {
            patchLast((m) => ({ ...m, error: event.message }));
          }
        },
      });
    } catch (err) {
      if (err.name !== "AbortError") patchLast((m) => ({ ...m, error: err.message || "The assistant could not answer just now." }));
    } finally {
      patchLast((m) => ({ ...m, pending: false, content: m.content || (m.error || m.charts?.length || m.links?.length || m.actions?.length ? m.content : "(Stopped.)") }));
      setBusy(false);
      setStatus("");
      abortRef.current = null;
    }
  };

  const patchAction = (msgIndex, actionId, patch) =>
    setMessages((list) =>
      list.map((m, i) =>
        i === msgIndex ? { ...m, actions: (m.actions || []).map((a) => (a.id === actionId ? { ...a, ...patch } : a)) } : m
      )
    );

  // Runs the action as this person, then tells the assistant how it went so
  // it can carry on (the next step, or what to do about a failure).
  const confirmAction = async (msgIndex, action) => {
    if (busy) return;
    patchAction(msgIndex, action.id, { state: "running" });
    let outcome;
    try {
      const result = await runAction(action.action, action.params, { schoolId, userId, school, files: filesRef.current });
      if (result?.detail) setSecrets((x) => ({ ...x, [action.id]: result.detail }));
      outcome = { state: "done", result: result?.text || "Done.", link: result?.link || null };
    } catch (err) {
      outcome = { state: "failed", result: err.message || "That did not work." };
    }
    const next = messagesRef.current.map((m, i) =>
      i === msgIndex ? { ...m, actions: (m.actions || []).map((x) => (x.id === action.id ? { ...x, ...outcome } : x)) } : m
    );
    setMessages(next);
    ask(`[${outcome.state === "done" ? "Done" : "Failed"}] ${action.summary} — ${outcome.result}`, { note: true, base: next });
  };

  const cancelAction = (msgIndex, action) => {
    patchAction(msgIndex, action.id, { state: "cancelled" });
    // Kept in the conversation so the assistant knows, without asking it now.
    setMessages((list) => [...list, { role: "user", content: `[Cancelled] ${action.summary}`, note: true }]);
  };

  const stop = () => abortRef.current?.abort();

  const reset = () => {
    if (busy) stop();
    setMessages([]);
    try {
      window.sessionStorage.removeItem(storageKey(userId, schoolId));
    } catch {
      // Nothing saved anyway.
    }
    inputRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ask(draft);
    }
  };

  // Grows with what is typed, up to about six lines.
  const autosize = (el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  };
  useEffect(() => autosize(inputRef.current), [draft]);

  if (!schoolId || !userId) return null;
  const suggestions = SUGGESTIONS[role] || SUGGESTIONS.admin;

  return (
    <>
      <button
        type="button"
        className={`ai-launch${open ? " is-open" : ""}`}
        aria-label="Ask the assistant"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon icon={zap} size={17} />
        <span className="ai-launch-label">{"Ask AI"}</span>
      </button>

      {open
        ? createPortal(
            <aside className="ai-panel" role="dialog" aria-label="Assistant">
              <header className="ai-head">
                <span className="ai-head-mark" aria-hidden="true">
                  <Icon icon={zap} size={16} />
                </span>
                <div className="ai-head-text">
                  <strong>{"Assistant"}</strong>
                  <span>{school?.name}</span>
                </div>
                <button type="button" className="ai-icon-btn" onClick={reset} aria-label="New chat" title="New chat">
                  <Icon icon={plus} size={18} />
                </button>
                <button type="button" className="ai-icon-btn" onClick={() => setOpen(false)} aria-label="Close" title="Close">
                  <Icon icon={xIcon} size={18} />
                </button>
              </header>

              <div className="ai-list" ref={listRef}>
                {messages.length === 0 ? (
                  <div className="ai-empty">
                    <h3>{"What can I help with?"}</h3>
                    <p>{"Ask about anything in the school you can see, or ask me to do something: add a person, post news, set an exam, move an application on, record a payment. I show you exactly what I'll do, and nothing happens until you confirm."}</p>
                    <div className="ai-suggest">
                      {suggestions.map((s) => (
                        <button key={s} type="button" onClick={() => ask(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messages.map((m, i) =>
                    m.role === "user" && m.note ? null : m.role === "user" ? (
                      <div key={i} className="ai-msg ai-user">
                        {m.files?.length ? (
                          <div className="ai-user-files">
                            {m.files.map((f) =>
                              f.url && filesRef.current.has(f.ref) ? (
                                <img key={f.ref} src={f.url} alt={f.name} title={f.name} />
                              ) : (
                                <span key={f.ref} className="ai-file-chip"><Icon icon={fileIcon} size={13} />{f.name}</span>
                              )
                            )}
                          </div>
                        ) : null}
                        {m.files ? m.typed : m.content}
                      </div>
                    ) : (
                      <div key={i} className="ai-msg ai-bot">
                        {m.content ? <Markdown text={m.content} onInternalLink={go} /> : null}
                        {(m.charts || []).map((c, ci) => (
                          <Chart key={ci} chart={c} />
                        ))}
                        {m.links?.length ? (
                          <div className="ai-links">
                            {m.links.map((l, li) => (
                              <button key={li} type="button" className="ai-link" onClick={() => go(l.path)}>
                                {l.label}
                                <Icon icon={arrowRight} size={14} />
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {(m.actions || []).map((a) => (
                          <ActionCard
                            key={a.id}
                            action={a}
                            secret={secrets[a.id]}
                            onConfirm={() => confirmAction(i, a)}
                            onCancel={() => cancelAction(i, a)}
                            onOpen={go}
                          />
                        ))}
                        {m.error ? <p className="ai-error">{m.error}</p> : null}
                        {m.pending && i === messages.length - 1 && (status || !m.content) ? (
                          <p className="ai-status">
                            <span className="ai-dots" aria-hidden="true">
                              <i />
                              <i />
                              <i />
                            </span>
                            {status || "Thinking"}
                          </p>
                        ) : null}
                      </div>
                    )
                  )
                )}
              </div>

              {pending.length ? (
                <div className="ai-pending">
                  {pending.map((f) => (
                    <span key={f.ref} className="ai-pending-item" title={`${f.name} · ${sizeLabel(f.size)}`}>
                      {f.url ? <img src={f.url} alt="" /> : <Icon icon={fileIcon} size={16} />}
                      <span className="ai-pending-name">{f.name}</span>
                      <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setPending((x) => x.filter((y) => y.ref !== f.ref))}>
                        <Icon icon={xIcon} size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <form
                className={`ai-compose${dragging ? " is-dragging" : ""}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(draft);
                }}
                onDragOver={(e) => {
                  if (Array.from(e.dataTransfer?.types || []).includes("Files")) {
                    e.preventDefault();
                    setDragging(true);
                  }
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  if (e.dataTransfer?.files?.length) {
                    e.preventDefault();
                    setDragging(false);
                    addFiles(e.dataTransfer.files);
                  }
                }}
              >
                <button type="button" className="ai-attach" onClick={() => fileInputRef.current?.click()} aria-label="Attach a file" title="Attach a file (or paste a picture)">
                  <Icon icon={paperclip} size={17} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <textarea
                  onPaste={onPaste}
                  ref={inputRef}
                  rows={1}
                  value={draft}
                  placeholder={pending.length ? "Say what to do with it…" : "Ask anything, or paste a picture…"}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  aria-label="Message the assistant"
                />
                {busy ? (
                  <button type="button" className="ai-send is-stop" onClick={stop} aria-label="Stop">
                    <Icon icon={square} size={14} />
                  </button>
                ) : (
                  <button type="submit" className="ai-send" disabled={!draft.trim() && !pending.length} aria-label="Send">
                    <Icon icon={send} size={16} />
                  </button>
                )}
              </form>
              <p className="ai-foot">{"It only sees what your account can see. Check important figures before acting on them."}</p>
            </aside>,
            document.body
          )
        : null}
    </>
  );
};

export default Assistant;
