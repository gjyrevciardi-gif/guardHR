import hashlib
import io
import random
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass

from docx import Document
from pypdf import PdfReader


STOPWORDS = {
    "about", "after", "again", "against", "also", "because", "before", "between", "could", "during", "every",
    "from", "have", "into", "more", "other", "should", "their", "there", "these", "this", "through", "under",
    "using", "were", "where", "which", "while", "with", "without", "would", "what", "when", "will", "than",
    "and", "the", "for", "are", "was", "has", "that", "into", "over",
    "dhe", "apo", "nga", "per", "eshte", "jane", "kjo", "kete", "keto", "kur", "nese", "nuk", "ose", "pas",
    "para", "prej", "sepse", "tek", "tha", "nje", "me", "ne", "te", "si", "ka", "do", "ku", "qka", "cka",
    "cilat", "cili", "cila", "jep", "duhet", "mund", "shume",
}

LETTER_TO_INDEX = {letter: index for index, letter in enumerate("ABCDEFGH")}


@dataclass
class GeneratedQuestion:
    prompt: str
    options: list[str]
    correct_option_index: int


def extract_text_from_upload(filename: str, content: bytes) -> str:
    name = filename.lower()
    if name.endswith(".pdf"):
        reader = PdfReader(io.BytesIO(content))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages)
    if name.endswith(".docx"):
        document = Document(io.BytesIO(content))
        return "\n".join(paragraph.text for paragraph in document.paragraphs)
    if name.endswith(".txt") or name.endswith(".md"):
        return content.decode("utf-8", errors="ignore")
    raise ValueError("Unsupported file type. Upload PDF, DOCX, TXT, or MD.")


def strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(char for char in normalized if not unicodedata.combining(char))


def normalize_token(value: str) -> str:
    value = strip_accents(value).lower().strip("-_ ")
    return re.sub(r"[^a-z0-9_-]", "", value)


def normalize_extracted_text(text: str) -> str:
    replacements = {
        "\ufeff": "",
        "\u00a0": " ",
        "\r\n": "\n",
        "\r": "\n",
        "•": "\n- ",
        "·": " ",
        "“": '"',
        "”": '"',
        "‘": "'",
        "’": "'",
        "✓": " [x] ",
    }
    for source, target in replacements.items():
        text = text.replace(source, target)

    # Some PDFs extract everything in a single line. Add soft breaks before
    # likely numbered questions and option markers so the MCQ parser can see them.
    text = re.sub(r"(?<!^)(?<!\n)\s+((?:q(?:uestion)?\s*)?\d{1,3}\s*[\).:-]\s+)", r"\n\1", text, flags=re.IGNORECASE)
    text = re.sub(r"(?<!^)(?<!\n)\s+([A-Ha-h]\s*[\).:-]\s+)", r"\n\1", text)

    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def clean_text(text: str) -> str:
    text = normalize_extracted_text(text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def split_sentences(text: str) -> list[str]:
    normalized = normalize_extracted_text(text)
    candidates: list[str] = []
    for line in normalized.splitlines():
        if re.match(r"^(?:[-*]\s*)?[A-Ha-h]\s*[\).:-]\s+", line):
            continue
        if re.match(r"^(?:answer key|answers|correct answers|pergjigj)", line, flags=re.IGNORECASE):
            continue
        candidates.extend(re.split(r"(?<=[.!?])\s+", line))

    seen: set[str] = set()
    output: list[str] = []
    for row in candidates:
        cleaned = row.strip(" -*\t")
        cleaned = re.sub(r"\s+", " ", cleaned)
        fingerprint = normalize_token(cleaned[:90])
        if 35 <= len(cleaned) <= 320 and fingerprint and fingerprint not in seen:
            output.append(cleaned)
            seen.add(fingerprint)
    return output


def keyword_candidates(text: str) -> list[str]:
    words = re.findall(r"[A-Za-zÀ-ÖØ-öø-ÿÇçËë][A-Za-zÀ-ÖØ-öø-ÿÇçËë0-9_-]{3,}", text)
    counts: Counter[str] = Counter()
    display: dict[str, str] = {}
    for word in words:
        normalized = normalize_token(word)
        if not normalized or normalized in STOPWORDS or normalized.isdigit():
            continue
        counts[normalized] += 1
        display.setdefault(normalized, word.strip("-_"))
    return [display[word] for word, _ in counts.most_common(160)]


def infer_title(filename: str, text: str) -> str:
    normalized = normalize_extracted_text(text)
    lines = [line.strip(" #:-") for line in normalized.splitlines() if len(line.strip()) >= 4]
    first = next((line for line in lines if len(line) <= 90 and not re.match(r"^(?:q(?:uestion)?\s*)?\d+[\).:-]", line, flags=re.IGNORECASE)), "")
    if first:
        return first[:90]
    fallback = re.sub(r"\.[^.]+$", "", filename).replace("_", " ").replace("-", " ").strip()
    return fallback.title()[:90] or "Generated Nemo Call Test"


def extract_answer_key(text: str) -> dict[int, str]:
    answer_key: dict[int, str] = {}
    in_key_section = False

    for line in normalize_extracted_text(text).splitlines():
        lowered = strip_accents(line).lower()
        if re.search(r"\b(answer key|answers|correct answers|pergjigjet|pergjigje)\b", lowered):
            in_key_section = True

        # In a key section, accept compact lines such as "1. B 2. C 3. A".
        # Outside a key section, only accept very short answer-only lines.
        if in_key_section or len(line) <= 32:
            for match in re.finditer(r"\b(\d{1,3})\s*[\).:-]\s*([A-Ha-h])\b", line):
                answer_key[int(match.group(1))] = match.group(2).upper()

    return answer_key


def question_blocks(text: str) -> list[tuple[int, str]]:
    normalized = normalize_extracted_text(text)
    marker = re.compile(r"(?im)^\s*(?:q(?:uestion)?\s*)?(\d{1,3})\s*[\).:-]\s+")
    matches = list(marker.finditer(normalized))

    # If the PDF extracted numbered questions inline, add breaks and try again.
    if len(matches) < 2:
        normalized = re.sub(r"\s+(?=(?:q(?:uestion)?\s*)?\d{1,3}\s*[\).:-]\s+)", "\n", normalized, flags=re.IGNORECASE)
        matches = list(marker.finditer(normalized))

    blocks: list[tuple[int, str]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(normalized)
        blocks.append((int(match.group(1)), normalized[match.start():end].strip()))
    return blocks


def parse_answer_marker(text: str) -> str | None:
    match = re.search(
        r"(?im)\b(?:answer|correct answer|correct|pergjigj(?:e|ja|ja e sakte)|sakte)\b\s*(?:is|eshte)?\s*[:\-]?\s*([A-Ha-h]|\d{1,2})\b",
        text,
    )
    return match.group(1).upper() if match else None


def remove_answer_lines(text: str) -> str:
    return re.sub(
        r"(?im)^\s*(?:answer|correct answer|correct|pergjigj(?:e|ja|ja e sakte)|sakte)\b.*$",
        "",
        text,
    ).strip()


def clean_option(value: str) -> tuple[str, bool]:
    marked = bool(re.search(r"(\[x\]|\*|\(correct\)|\bsakte\b|\bcorrect\b)", value, flags=re.IGNORECASE))
    value = re.sub(r"(\[x\]|\*|\(correct\)|\bsakte\b|\bcorrect\b)", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\s+", " ", value)
    return value.strip(" -:;.\t"), marked


def extract_options(body: str) -> tuple[str, list[str], int | None]:
    body = remove_answer_lines(body)
    marker = re.compile(r"(?im)(?:^|\n)\s*([A-Ha-h])\s*[\).:-]\s+")
    matches = list(marker.finditer(body))

    if len(matches) >= 2:
        question_text = body[:matches[0].start()].strip(" \n:-")
        options: list[str] = []
        marked_index: int | None = None
        for index, match in enumerate(matches):
            end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
            option, marked = clean_option(body[match.end():end])
            if option:
                if marked:
                    marked_index = len(options)
                options.append(option)
        return question_text, options, marked_index

    inline_marker = re.compile(r"(?is)(?:^|\s)([A-Ha-h])\s*[\).:-]\s+(.+?)(?=(?:\s+[A-Ha-h]\s*[\).:-]\s+)|$)")
    matches = list(inline_marker.finditer(body))
    if len(matches) >= 2:
        question_text = body[:matches[0].start()].strip(" \n:-")
        options = []
        marked_index = None
        for match in matches:
            option, marked = clean_option(match.group(2))
            if option:
                if marked:
                    marked_index = len(options)
                options.append(option)
        return question_text, options, marked_index

    return body.strip(), [], None


def parse_existing_multiple_choice(text: str, question_count: int) -> list[GeneratedQuestion]:
    answer_key = extract_answer_key(text)
    parsed: list[GeneratedQuestion] = []
    seen_prompts: set[str] = set()

    for number, block in question_blocks(text):
        body = re.sub(r"(?is)^\s*(?:q(?:uestion)?\s*)?\d{1,3}\s*[\).:-]\s+", "", block, count=1).strip()
        inline_answer = parse_answer_marker(body)
        question_text, options, marked_index = extract_options(body)
        if len(options) < 2 or len(question_text) < 4:
            continue

        if len(options) > 8:
            options = options[:8]

        correct_index = marked_index
        answer_letter = answer_key.get(number) or inline_answer
        if correct_index is None and answer_letter:
            if answer_letter in LETTER_TO_INDEX and LETTER_TO_INDEX[answer_letter] < len(options):
                correct_index = LETTER_TO_INDEX[answer_letter]
            elif answer_letter.isdigit() and 1 <= int(answer_letter) <= len(options):
                correct_index = int(answer_letter) - 1

        # If the PDF has no answer key, keep the question and default to first
        # option so the host can correct it in Review/Edit before assigning.
        if correct_index is None:
            correct_index = 0

        prompt = re.sub(r"\s+", " ", question_text).strip()
        fingerprint = normalize_token(prompt[:120])
        if fingerprint in seen_prompts:
            continue
        seen_prompts.add(fingerprint)
        parsed.append(GeneratedQuestion(prompt=prompt, options=options, correct_option_index=correct_index))
        if len(parsed) >= question_count:
            break

    return parsed


def deterministic_rng(text: str) -> random.Random:
    digest = hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()
    return random.Random(int(digest[:12], 16))


def make_keyword_question(sentence: str, answer: str, distractors: list[str], rng: random.Random) -> GeneratedQuestion | None:
    if len(distractors) < 3:
        return None
    sampled = rng.sample(distractors, 3)
    options = [answer, *sampled]
    rng.shuffle(options)
    correct_index = options.index(answer)
    prompt_sentence = re.sub(rf"\b{re.escape(answer)}\b", "____", sentence, count=1, flags=re.IGNORECASE)
    if prompt_sentence == sentence:
        prompt_sentence = sentence
    return GeneratedQuestion(
        prompt=f"Cili term mungon ne kete fragment?\n\"{prompt_sentence}\"",
        options=[option[:1].upper() + option[1:] for option in options],
        correct_option_index=correct_index,
    )


def generate_keyword_questions(text: str, question_count: int, existing: list[GeneratedQuestion] | None = None) -> list[GeneratedQuestion]:
    cleaned = clean_text(text)
    sentences = split_sentences(text)
    keywords = keyword_candidates(cleaned)
    if len(keywords) < 4 or not sentences:
        if existing:
            return existing
        raise ValueError("Not enough readable text to generate questions. Try a longer PDF/DOCX/TXT.")

    rng = deterministic_rng(cleaned)
    questions: list[GeneratedQuestion] = list(existing or [])
    used_answers = {normalize_token(question.options[question.correct_option_index]) for question in questions}
    used_prompts = {normalize_token(question.prompt[:140]) for question in questions}

    for sentence in sentences:
        sentence_lower = strip_accents(sentence).lower()
        answer = next(
            (
                keyword for keyword in keywords
                if normalize_token(keyword) not in used_answers
                and re.search(rf"\b{re.escape(strip_accents(keyword).lower())}\b", sentence_lower)
            ),
            None,
        )
        if not answer:
            continue
        distractors = [item for item in keywords if normalize_token(item) != normalize_token(answer)]
        question = make_keyword_question(sentence, answer, distractors, rng)
        if not question:
            continue
        fingerprint = normalize_token(question.prompt[:140])
        if fingerprint in used_prompts:
            continue
        questions.append(question)
        used_prompts.add(fingerprint)
        used_answers.add(normalize_token(answer))
        if len(questions) >= question_count:
            return questions

    # Fallback: make concept questions from the top keywords and a nearby fragment.
    for answer in keywords:
        if normalize_token(answer) in used_answers:
            continue
        related = next((sentence for sentence in sentences if normalize_token(answer) in normalize_token(sentence)), sentences[0])
        distractors = [item for item in keywords if normalize_token(item) != normalize_token(answer)]
        question = make_keyword_question(related, answer, distractors, rng)
        if not question:
            continue
        question.prompt = f"Sipas dokumentit, cili term lidhet me kete fragment?\n\"{related[:220]}\""
        fingerprint = normalize_token(question.prompt[:140])
        if fingerprint in used_prompts:
            continue
        questions.append(question)
        used_prompts.add(fingerprint)
        used_answers.add(normalize_token(answer))
        if len(questions) >= question_count:
            break

    if len(questions) < 2:
        raise ValueError("Could not generate enough questions from this document.")
    return questions


def generate_questions(text: str, question_count: int = 10) -> list[GeneratedQuestion]:
    if question_count < 1:
        raise ValueError("Question count must be positive.")

    # First path: the PDF/DOCX already contains numbered multiple-choice questions.
    parsed = parse_existing_multiple_choice(text, question_count=question_count)
    if len(parsed) >= question_count:
        return parsed[:question_count]

    # Second path: supplement parsed questions, or generate from prose.
    return generate_keyword_questions(text, question_count=question_count, existing=parsed)
