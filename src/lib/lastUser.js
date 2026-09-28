// Who last had a session on this device. The sign-in page uses it to decide
// whether "take me back to where I was" applies: it does for the same person,
// and never for someone else. Signing out on a shared computer and handing it
// over used to land the next person on the last one's exact page (a parent's
// /Fees?bill=..., opened by the school owner).
//
// localStorage can be unavailable (a private window, blocked site data), so
// every read and write is guarded; without it the sign-in page simply treats
// the device as new.
const KEY = "schoolivio.lastUserId";

export const rememberUser = (userId) => {
  if (!userId) return;
  try {
    window.localStorage.setItem(KEY, userId);
  } catch {
    // Not stored; nothing depends on it.
  }
};

export const lastUserId = () => {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
