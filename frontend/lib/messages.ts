// The API answers in English; the interface is Albanian. Unknown messages fall through unchanged.
const exact: Record<string, string> = {
  "Invalid authentication credentials": "Sesioni ka skaduar. Kyçu përsëri.",
  "Email or password is incorrect": "Email-i ose fjalëkalimi nuk është i saktë.",
  "Registration is disabled. Ask an administrator for an account.": "Regjistrimi është i mbyllur. Kërkoji administratorit një llogari.",
  "Administrator access required": "Duhen të drejta administratori.",
  "Cross-origin request blocked": "Kërkesa u bllokua për arsye sigurie.",
  "Too many requests. Try again later.": "Shumë kërkesa. Provo përsëri pas pak.",
  "Session not found": "Call-i nuk u gjet.",
  "Test not found": "Testi nuk u gjet.",
  "Interview link is invalid": "Linku i call-it nuk është i vlefshëm.",
  "Interview link has expired": "Linku i call-it ka skaduar.",
  "Session is already completed": "Call-i ka përfunduar tashmë.",
  "Session is not in progress": "Call-i nuk është në progres.",
  "Explicit consent is required": "Nevojitet pëlqimi i qartë.",
  "Consent is required before starting": "Pëlqimi nevojitet para nisjes.",
  "Email verification is required before starting": "Verifiko email-in me kodin para se të hysh.",
  "Consent is required before verification": "Pranoje fillimisht njoftimin e pëlqimit.",
  "Email verification is not required for this call": "Ky call nuk kërkon verifikim të email-it.",
  "Email is already verified": "Email-i është verifikuar tashmë.",
  "Session is not open for verification": "Ky call nuk është më i hapur për verifikim.",
  "Wait before requesting another code": "Prit pak para se të kërkosh një kod tjetër.",
  "Too many codes requested. Ask the host for a new link.": "U kërkuan shumë kode. Kërkoji host-it një link të ri.",
  "The code could not be sent. Try again or ask the host.": "Kodi nuk u dërgua. Provo përsëri ose kontakto host-in.",
  "No code was requested": "Kërko fillimisht një kod.",
  "The code has expired. Request a new one.": "Kodi ka skaduar. Kërko një të ri.",
  "Too many wrong attempts. Request a new code.": "Shumë përpjekje të gabuara. Kërko një kod të ri.",
  "The code is incorrect": "Kodi nuk është i saktë.",
  "Expiration must be in the future": "Skadimi duhet të jetë në të ardhmen.",
  "No test is assigned to this session": "Ky call nuk ka test të caktuar.",
  "Test was already submitted": "Testi është dërguar tashmë.",
  "This email has already submitted this test": "Ky email e ka dërguar tashmë këtë test.",
  "Test link is invalid or closed": "Linku i testit nuk është i vlefshëm ose është mbyllur.",
  "Event limit reached for this session": "U arrit kufiri i eventeve për këtë call.",
  "Unsupported image type": "Lloji i imazhit nuk mbështetet.",
  "Frame is too large": "Imazhi është shumë i madh.",
  "File is too large. Max 8MB.": "File është shumë i madh. Maksimumi 8MB.",
  "Unsupported file type. Upload PDF, DOCX, TXT, or MD.": "Lloji i file-it nuk mbështetet. Ngarko PDF, DOCX, TXT ose MD.",
  "The PDF could not be read.": "PDF-ja nuk mund të lexohet.",
  "The DOCX file could not be read.": "File DOCX nuk mund të lexohet.",
  "DOCX content is too large.": "Përmbajtja e DOCX është shumë e madhe.",
  "Question count must be between 2 and 50": "Numri i pyetjeve duhet të jetë mes 2 dhe 50.",
  "Text answer is too long": "Përgjigjja me tekst është shumë e gjatë.",
  "Invalid answer option": "Opsioni i përgjigjes nuk është i vlefshëm.",
};

const patterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/^Question (\d+) needs at least 2 options$/, (m) => `Pyetja ${m[1]} ka nevojë për të paktën 2 opsione.`],
  [/^Correct answer is required for question (\d+)$/, (m) => `Pyetja ${m[1]} ka nevojë për përgjigjen e saktë.`],
  [/^Correct answer is invalid for question (\d+)$/, (m) => `Përgjigjja e saktë e pyetjes ${m[1]} nuk është e vlefshme.`],
  [/^Question (\d+) does not belong to this test$/, (m) => `Pyetja ${m[1]} nuk i përket këtij testi.`],
  [/^PDF has too many pages/, () => "PDF-ja ka shumë faqe."],
];

export function translateMessage(message: string): string {
  if (exact[message]) return exact[message];
  for (const [pattern, build] of patterns) {
    const match = message.match(pattern);
    if (match) return build(match);
  }
  return message;
}

export const fallbackMessages: Record<number, string> = {
  401: "Sesioni ka skaduar. Kyçu përsëri.",
  403: "Nuk ke leje për këtë veprim.",
  404: "Nuk u gjet.",
  413: "File ose të dhënat janë shumë të mëdha.",
  429: "Shumë kërkesa. Provo përsëri pas pak.",
};
