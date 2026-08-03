import io
import random
import re
from collections import Counter
from dataclasses import dataclass

from docx import Document
from pypdf import PdfReader


STOPWORDS = {
    "about", "after", "again", "against", "also", "because", "before", "between", "could", "during", "every",
    "from", "have", "into", "more", "other", "should", "their", "there", "these", "this", "through", "under",
    "using", "were", "where", "which", "while", "with", "without", "would",
    "dhe", "apo", "nga", "per", "për", "eshte", "është", "jane", "janë", "kjo", "kete", "këtë", "keto", "këto",
    "kur", "nese", "nëse", "nuk", "ose", "pas", "para", "prej", "sepse", "si", "tek", "te", "të", "tha",
}


@dataclass
class GeneratedQuestion:
    prompt: str
    options: list[str]
    correct_option_index: int


def extract_text_from_upload(filename: str, content: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        reader = PdfReader(io.BytesIO(content))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    if name.endswith(".docx"):
        document = Document(io.BytesIO(content))
        return "\n".join(paragraph.text for paragraph in document.paragraphs)
    if name.endswith(".txt") or name.endswith(".md"):
        return content.decode("utf-8", errors="ignore")
    raise ValueError("Unsupported file type. Upload PDF, DOCX, TXT, or MD.")


def clean_text(text: str) -> str:
    text = text.replace("\ufeff", "")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def split_sentences(text: str) -> list[str]:
    rows = re.split(r"(?<=[.!?])\s+", text)
    return [row.strip(" -•\t") for row in rows if 55 <= len(row.strip()) <= 280]


def keyword_candidates(text: str) -> list[str]:
    words = re.findall(r"\b[\wçÇëË-]{5,}\b", text, flags=re.UNICODE)
    normalized = [word.strip("-_").lower() for word in words]
    counts = Counter(word for word in normalized if word not in STOPWORDS and not word.isdigit())
    return [word for word, _ in counts.most_common(80)]


def infer_title(filename: str, text: str) -> str:
    text = text.replace("\ufeff", "")
    lines = [line.strip(" #:-") for line in text.splitlines() if len(line.strip()) >= 4]
    first = next((line for line in lines if len(line) <= 90), "")
    if first:
        return first[:90]
    fallback = re.sub(r"\.[^.]+$", "", filename).replace("_", " ").replace("-", " ").strip()
    return fallback.title()[:90] or "Generated Nemo Call Test"


def generate_questions(text: str, question_count: int = 8) -> list[GeneratedQuestion]:
    cleaned = clean_text(text)
    sentences = split_sentences(cleaned)
    keywords = keyword_candidates(cleaned)
    if len(keywords) < 4 or not sentences:
        raise ValueError("Not enough readable text to generate questions. Try a longer PDF/DOCX/TXT.")

    questions: list[GeneratedQuestion] = []
    used_answers: set[str] = set()

    for sentence in sentences:
        sentence_lower = sentence.lower()
        answer = next((keyword for keyword in keywords if keyword not in used_answers and re.search(rf"\b{re.escape(keyword)}\b", sentence_lower)), None)
        if not answer:
            continue
        distractors = [item for item in keywords if item != answer and item not in used_answers][:18]
        if len(distractors) < 3:
            continue
        options = [answer, *random.sample(distractors, 3)]
        random.shuffle(options)
        correct_index = options.index(answer)
        prompt_sentence = re.sub(rf"\b{re.escape(answer)}\b", "____", sentence, count=1, flags=re.IGNORECASE)
        questions.append(GeneratedQuestion(
            prompt=f"Cili term mungon në këtë fjali?\n“{prompt_sentence}”",
            options=[option[:1].upper() + option[1:] for option in options],
            correct_option_index=correct_index,
        ))
        used_answers.add(answer)
        if len(questions) >= question_count:
            break

    if len(questions) < 2:
        raise ValueError("Could not generate enough questions from this document.")
    return questions
