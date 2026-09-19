// Server-side twin of AdmissionLetter.jsx's fillLetterMergeTags — same
// regex, same "unknown tag resolves to empty string" behaviour, so an
// admission_letter_offer_intro/enrolled_intro/closing template reads
// identically whether it ends up on the printed letter or in this email.
export const fillMergeTags = (template: string, vars: Record<string, string | null | undefined>) =>
  (template || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, tag: string) => vars[tag] ?? "");
