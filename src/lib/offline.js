// Offline-tolerant answer queue for exams.
//
// Every answer is written to localStorage the instant it is typed, before any
// network call. A background loop then pushes anything unsynced to the server
// with backoff. A dropped connection therefore costs nothing: the paper lives
// on the device until it can be delivered.

const key = (attemptId) => `exam-answers:${attemptId}`;

const readStore = (attemptId) => {
  try {
    return JSON.parse(localStorage.getItem(key(attemptId)) || "{}");
  } catch {
    return {};
  }
};

const writeStore = (attemptId, store) => {
  try {
    localStorage.setItem(key(attemptId), JSON.stringify(store));
  } catch {
    // Private mode or a full quota. The in-memory copy still works.
  }
};

export const loadLocalAnswers = (attemptId) => readStore(attemptId);

export const clearLocalAnswers = (attemptId) => {
  try {
    localStorage.removeItem(key(attemptId));
  } catch {
    /* nothing useful to do */
  }
};

// Seeds the local store from whatever the server already has, without
// overwriting a local edit that has not synced yet.
export const mergeServerAnswers = (attemptId, serverRows) => {
  const store = readStore(attemptId);
  serverRows.forEach((row) => {
    const existing = store[row.question_id];
    if (!existing || existing.synced) {
      store[row.question_id] = {
        optionId: row.selected_option_id,
        text: row.answer_text || "",
        synced: true,
        updatedAt: Date.now(),
      };
    }
  });
  writeStore(attemptId, store);
  return store;
};

export const recordLocalAnswer = (attemptId, questionId, patch) => {
  const store = readStore(attemptId);
  store[questionId] = {
    ...(store[questionId] || {}),
    ...patch,
    synced: false,
    updatedAt: Date.now(),
  };
  writeStore(attemptId, store);
  return store;
};

const markSynced = (attemptId, questionId, at) => {
  const store = readStore(attemptId);
  const entry = store[questionId];
  // Only clear the flag if nothing was typed since this push started.
  if (entry && entry.updatedAt <= at) {
    store[questionId] = { ...entry, synced: true };
    writeStore(attemptId, store);
  }
};

export const pendingCount = (attemptId) =>
  Object.values(readStore(attemptId)).filter((entry) => !entry.synced).length;

/**
 * Pushes every unsynced answer. Returns { ok, pending, error }.
 * `ok` false means the network is unavailable or the server refused.
 */
export const syncAnswers = async (attemptId, saveAnswer) => {
  const store = readStore(attemptId);
  const unsynced = Object.entries(store).filter(([, entry]) => !entry.synced);

  if (unsynced.length === 0) return { ok: true, pending: 0 };

  let failure = null;
  for (const [questionId, entry] of unsynced) {
    const at = entry.updatedAt;
    try {
      await saveAnswer({
        attemptId,
        questionId,
        optionId: entry.optionId,
        text: entry.text,
      });
      markSynced(attemptId, questionId, at);
    } catch (err) {
      failure = err;
      // Stop on the first failure: if the network is down the rest will fail
      // too, and hammering it achieves nothing.
      break;
    }
  }

  return {
    ok: !failure,
    pending: pendingCount(attemptId),
    error: failure,
  };
};

// A failed fetch and a refused write mean very different things to a student:
// one is "your wifi blinked", the other is "your time is up".
export const isNetworkError = (error) => {
  if (!error) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = String(error.message || error).toLowerCase();
  return (
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("failed to send")
  );
};
