"""A public exam sat by one candidate: what they are shown, how their answers map back, and the clock."""

import random
from datetime import datetime
from math import ceil

from .enums import QuestionType
from .models import ExamAttempt, Test, TestQuestion
from .schemas import TestQuestionOut
from .signals import as_utc

# A submission this much past the limit is not reported: the browser sends at 0:00, and the request takes time.
OVER_LIMIT_GRACE_SECONDS = 30

Arrangement = list[tuple[TestQuestion, list[int]]]


def make_layout(questions: list[TestQuestion], shuffle: bool) -> list[dict]:
    """The order one candidate sees: [{"id": question id, "options": [original option indexes, in the order shown]}]."""
    layout = [{"id": question.id, "options": list(range(len(question.options)))} for question in questions]
    if shuffle:
        for item in layout:
            random.shuffle(item["options"])
        random.shuffle(layout)
    return layout


def arrange(questions: list[TestQuestion], layout: list[dict]) -> Arrangement:
    """The layout applied to the questions as they are now. The host can edit a test while someone is sitting it, so a
    question that was removed is skipped, one that was added comes last, and options whose count changed show unshuffled."""
    by_id = {question.id: question for question in questions}
    arranged: Arrangement = []
    for item in layout:
        question = by_id.pop(item["id"], None)
        if question is None:
            continue
        identity = list(range(len(question.options)))
        arranged.append((question, item["options"] if sorted(item["options"]) == identity else identity))
    arranged += [(question, list(range(len(question.options)))) for question in by_id.values()]
    return arranged


def shown_questions(arrangement: Arrangement) -> list[TestQuestionOut]:
    """What goes to the candidate: numbered by where they are shown, options in the order shown, no answer key."""
    return [
        TestQuestionOut(id=question.id, position=place, question_type=question.question_type, prompt=question.prompt, options=[question.options[i] for i in order])
        for place, (question, order) in enumerate(arrangement, start=1)
    ]


def original_answers(arrangement: Arrangement, answers: dict) -> dict:
    """Answers as sent (the option position the candidate saw) turned into the test's own option numbers. Anything that
    is not a valid choice is left alone for grade_answers to reject."""
    mapped = dict(answers)
    for question, order in arrangement:
        if question.question_type != QuestionType.multiple_choice or question.id not in mapped:
            continue
        try:
            shown = int(mapped[question.id])
        except (TypeError, ValueError):
            continue
        if 0 <= shown < len(order):
            mapped[question.id] = order[shown]
    return mapped


def seconds_left(test: Test, attempt: ExamAttempt, now: datetime) -> int | None:
    """Whole seconds until the limit (0 once past it); None when the test has no limit."""
    if not test.time_limit_minutes:
        return None
    return max(0, ceil(test.time_limit_minutes * 60 - (now - as_utc(attempt.started_at)).total_seconds()))


def over_limit_seconds(test: Test, attempt: ExamAttempt, now: datetime) -> int | None:
    """How far past the limit a submission arrived, or None when it was within it (or within the grace)."""
    if not test.time_limit_minutes:
        return None
    late = (now - as_utc(attempt.started_at)).total_seconds() - test.time_limit_minutes * 60
    return round(late) if late > OVER_LIMIT_GRACE_SECONDS else None
