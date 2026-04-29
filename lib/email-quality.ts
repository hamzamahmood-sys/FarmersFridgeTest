import type { EmailQuality, StoredEmail } from "@/lib/types";

type QualityInput = Pick<StoredEmail, "subject" | "body" | "companyName" | "contactName" | "sequenceStep">;

const BANNED_PHRASES = [
  "circle back",
  "touch base",
  "synergy",
  "game changer",
  "revolutionize",
  "guaranteed",
  "100% increase",
  "no brainer"
];

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function hasSpecificAnchor(email: QualityInput): boolean {
  const body = email.body.toLowerCase();
  const companyName = email.companyName?.trim().toLowerCase();
  const firstName = email.contactName?.trim().split(/\s+/)[0]?.toLowerCase();
  return Boolean(
    (companyName && body.includes(companyName)) ||
    (firstName && body.includes(firstName)) ||
    /\b(chicago|new york|nyc|new jersey|hospital|campus|office|employees?)\b/.test(body)
  );
}

export function analyzeEmailQuality(email: QualityInput): EmailQuality {
  const issues: string[] = [];
  const subject = email.subject.trim();
  const body = email.body.trim();
  const words = wordCount(body);

  if (subject.length > 70) {
    issues.push("Subject is over 70 characters.");
  }
  if (subject.length < 3) {
    issues.push("Subject is too short.");
  }
  if (words < 40) {
    issues.push("Body is under 40 words.");
  }
  if (words > 170) {
    issues.push("Body is over 170 words.");
  }
  if (!hasSpecificAnchor(email)) {
    issues.push("Add a specific company, contact, location, or workplace detail.");
  }
  if (!/(15[- ]?minute|quick (chat|call)|open to|worth|send (over|a)|helpful)/i.test(body)) {
    issues.push("CTA could be clearer or lower-friction.");
  }
  if (/[\u2013\u2014]/.test(body) || /[\u2013\u2014]/.test(subject)) {
    issues.push("Remove em/en dashes to match tone guidance.");
  }

  const lowerBody = body.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lowerBody.includes(phrase)) {
      issues.push(`Avoid "${phrase}".`);
    }
  }

  const score = Math.max(0, 100 - issues.length * 12 - Math.max(0, words - 140) * 0.4);

  return {
    score: Math.round(score),
    issues
  };
}

export function statusAfterQualityCheck(status: StoredEmail["status"] | undefined, quality: EmailQuality): StoredEmail["status"] {
  if (status && ["drafted", "sent", "replied"].includes(status)) return status;
  if (quality.score < 72 || quality.issues.length >= 3) return "needs_edits";
  return status ?? "approved";
}
