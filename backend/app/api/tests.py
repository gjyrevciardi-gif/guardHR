import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from .. import email as mailer
from ..database import get_db
from ..enums import QuestionType
from ..exams import arrange, make_layout, original_answers, over_limit_seconds, seconds_left, shown_questions
from ..models import ExamAttempt, ExamEmailCode, IntegrityEvent, InterviewSession, Test, TestQuestion, TestSubmission, User
from ..ratelimit import rate_limit
from ..retention import delete_test
from ..schemas import (
    ExamAttemptOut,
    ExamCodeConfirm,
    ExamCodeRequest,
    ExamCodeSent,
    ExamEventCreate,
    ExamStart,
    ExamStarted,
    PublicTestSubmit,
    TestCreate,
    TestDetailOut,
    TestOut,
    TestQuestionHostOut,
    TestReviewSessionOut,
    TestStandaloneSubmissionOut,
    TestSubmissionOut,
    TestUpdate,
)
from ..security import get_current_user
from ..services import audit, parse_uuid, request_ip
from ..signals import as_utc, severity_for
from ..test_generator import extract_text_from_upload, generate_questions, infer_title
from ..verification import CODE_TTL_SECONDS, EXAM_SENDS_WINDOW_SECONDS, MAX_ATTEMPTS, MAX_SENDS, RESEND_COOLDOWN_SECONDS, check_code, new_code

router = APIRouter(prefix="/tests", tags=["tests"])
public_router = APIRouter(prefix="/public/tests", tags=["public-tests"], dependencies=[Depends(rate_limit("public-tests", 240, 60))])


MAX_STANDALONE_SUBMISSIONS = 500


def owned_test(db: Session, test_id: str, user: User) -> Test:
    test = db.scalar(
        select(Test)
        .options(selectinload(Test.questions))
        .where(Test.id == parse_uuid(test_id, "Test not found"), Test.created_by == user.id)
    )
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    return test


def validate_questions(payload: TestCreate | TestUpdate) -> None:
    for index, question in enumerate(payload.questions):
        if question.question_type == QuestionType.short_text:
            continue
        cleaned_options = [option.strip() for option in question.options if option.strip()]
        if len(cleaned_options) < 2:
            raise HTTPException(status_code=422, detail=f"Question {index + 1} needs at least 2 options")
        if question.correct_option_index is None and not payload.form_mode:
            raise HTTPException(status_code=422, detail=f"Correct answer is required for question {index + 1}")
        if question.correct_option_index is not None and question.correct_option_index >= len(cleaned_options):
            raise HTTPException(status_code=422, detail=f"Correct answer is invalid for question {index + 1}")


def exam_settings(payload: TestCreate | TestUpdate) -> dict:
    """The time limit, shuffle and email code only mean something for a public exam; a plain form always saves none of them."""
    exam = not payload.form_mode
    return {
        "time_limit_minutes": payload.time_limit_minutes if exam else None,
        "shuffle": payload.shuffle if exam else False,
        "verify_candidate_email": payload.verify_candidate_email if exam else False,
    }


def build_question(test_id: str, index: int, question) -> TestQuestion:
    options = [option.strip() for option in question.options if option.strip()] if question.question_type == QuestionType.multiple_choice else []
    return TestQuestion(
        test_id=test_id,
        position=index + 1,
        question_type=question.question_type,
        prompt=question.prompt.strip(),
        options=options,
        correct_option_index=question.correct_option_index if question.question_type == QuestionType.multiple_choice else None,
    )


def grade_answers(questions: list[TestQuestion], answers: dict) -> tuple[dict, int, int]:
    checked_answers: dict = {}
    score = 0
    total = 0
    for question in questions:
        answer = answers.get(question.id)
        if question.question_type == QuestionType.short_text:
            if answer is None:
                continue
            value = str(answer).strip()
            if len(value) > 5000:
                raise HTTPException(status_code=422, detail="Text answer is too long")
            checked_answers[question.id] = value
            continue

        if answer is None:
            continue
        try:
            answer_index = int(answer)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="Invalid answer option") from None
        if answer_index < 0 or answer_index >= len(question.options):
            raise HTTPException(status_code=422, detail="Invalid answer option")
        checked_answers[question.id] = answer_index
        if question.correct_option_index is not None:
            total += 1
            if answer_index == question.correct_option_index:
                score += 1
    return checked_answers, score, total


def stored_exam_event(event: ExamEventCreate) -> dict:
    """JSON-safe form of a page signal, with its severity decided here (never trusted from the browser)."""
    return {
        "event_type": event.event_type.value,
        "started_at": event.started_at.isoformat(),
        "ended_at": event.ended_at.isoformat() if event.ended_at else None,
        "duration_seconds": event.duration_seconds,
        "severity": int(severity_for(event.event_type, event.duration_seconds, event.metadata)),
        "metadata": event.metadata,
    }


def test_to_detail(test: Test, db: Session, user: User) -> TestDetailOut:
    sessions = db.scalars(
        select(InterviewSession)
        .options(selectinload(InterviewSession.candidate))
        .where(InterviewSession.created_by == user.id, InterviewSession.test_id == test.id)
        .order_by(InterviewSession.created_at.desc())
    ).all()
    session_ids = [session.id for session in sessions]
    submissions_by_session: dict[str, TestSubmission] = {}
    event_summaries: dict[str, dict[str, int]] = {session_id: {} for session_id in session_ids}
    if session_ids:
        for submission in db.scalars(select(TestSubmission).where(TestSubmission.session_id.in_(session_ids))).all():
            submissions_by_session[submission.session_id] = submission
        counts = db.execute(
            select(IntegrityEvent.session_id, IntegrityEvent.event_type, func.count(IntegrityEvent.id))
            .where(IntegrityEvent.session_id.in_(session_ids))
            .group_by(IntegrityEvent.session_id, IntegrityEvent.event_type)
        ).all()
        for session_id, event_type, count in counts:
            event_summaries[session_id][event_type] = count

    review_sessions = []
    for session in sessions:
        submission = submissions_by_session.get(session.id)
        summary = event_summaries[session.id]
        review_sessions.append(
            TestReviewSessionOut(
                session_id=session.id,
                session_title=session.title,
                candidate_name=session.candidate.full_name,
                candidate_email=session.candidate.email,
                status=session.status,
                review_status=session.review_status,
                event_count=sum(summary.values()),
                event_summary=summary,
                submitted_at=submission.submitted_at if submission else None,
                score=submission.score if submission else None,
                total=submission.total if submission else None,
                answers=submission.answers if submission else None,
            )
        )

    standalone = db.scalars(
        select(TestSubmission)
        .where(TestSubmission.test_id == test.id, TestSubmission.session_id.is_(None))
        .order_by(TestSubmission.submitted_at.desc())
        .limit(MAX_STANDALONE_SUBMISSIONS)
    ).all()
    now = datetime.now(timezone.utc)
    unfinished = db.scalars(
        select(ExamAttempt).where(ExamAttempt.test_id == test.id, ExamAttempt.submitted_at.is_(None)).order_by(ExamAttempt.started_at.desc()).limit(MAX_STANDALONE_SUBMISSIONS)
    ).all()
    return TestDetailOut(
        **TestOut.from_test(test, include_questions=False).model_dump(exclude={"questions"}),
        questions=[TestQuestionHostOut.model_validate(question) for question in test.questions],
        sessions=review_sessions,
        standalone_submissions=[TestStandaloneSubmissionOut.model_validate(submission) for submission in standalone],
        unfinished_attempts=[ExamAttemptOut.model_validate(attempt).model_copy(update={"expired": seconds_left(test, attempt, now) == 0}) for attempt in unfinished],
    )


@router.get("", response_model=list[TestOut])
def list_tests(limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    question_count = select(func.count(TestQuestion.id)).where(TestQuestion.test_id == Test.id).correlate(Test).scalar_subquery()
    rows = db.execute(
        select(Test, question_count).where(Test.created_by == user.id).order_by(Test.created_at.desc(), Test.id).limit(limit).offset(offset)
    ).all()
    return [TestOut.from_test(test, include_questions=False, question_count=count) for test, count in rows]


@router.post("", response_model=TestOut, status_code=201)
def create_test(payload: TestCreate, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    validate_questions(payload)

    test = Test(
        created_by=user.id,
        title=payload.title,
        description=payload.description,
        form_mode=payload.form_mode,
        is_public=payload.is_public,
        **exam_settings(payload),
    )
    db.add(test)
    db.flush()
    for index, question in enumerate(payload.questions):
        db.add(build_question(test.id, index, question))
    audit(db, user, request, "test.created", "test", test.id, None, {"question_count": len(payload.questions), "form_mode": payload.form_mode})
    db.commit()
    db.refresh(test)
    test = db.scalar(select(Test).options(selectinload(Test.questions)).where(Test.id == test.id))
    return TestOut.from_test(test)


@router.post("/generate-from-file", response_model=TestOut, status_code=201)
async def generate_test_from_file(
    request: Request,
    file: UploadFile = File(...),
    question_count: int = Form(10),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if question_count < 2 or question_count > 50:
        raise HTTPException(status_code=422, detail="Question count must be between 2 and 50")
    content = await file.read(8_000_001)
    if len(content) > 8_000_000:
        raise HTTPException(status_code=413, detail="File is too large. Max 8MB.")
    try:
        raw_text = extract_text_from_upload(file.filename or "uploaded-file", content)
        questions = generate_questions(raw_text, question_count=question_count)
        title = infer_title(file.filename or "Generated test", raw_text)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    test = Test(
        created_by=user.id,
        title=title,
        description=f"Generated automatically from {file.filename}. Review questions before using in a live call.",
        form_mode=False,
        is_public=True,
    )
    db.add(test)
    db.flush()
    for index, question in enumerate(questions):
        db.add(TestQuestion(
            test_id=test.id,
            position=index + 1,
            question_type=QuestionType.multiple_choice,
            prompt=question.prompt,
            options=question.options,
            correct_option_index=question.correct_option_index,
        ))
    audit(db, user, request, "test.generated_from_file", "test", test.id, None, {"filename": file.filename, "question_count": len(questions)})
    db.commit()
    db.refresh(test)
    test = db.scalar(select(Test).options(selectinload(Test.questions)).where(Test.id == test.id))
    return TestOut.from_test(test)


@router.get("/{test_id}", response_model=TestDetailOut)
def get_test(test_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    test = owned_test(db, test_id, user)
    audit(db, user, request, "test.viewed", "test", test.id, None)
    db.commit()
    return test_to_detail(test, db, user)


@router.put("/{test_id}", response_model=TestDetailOut)
def update_test(test_id: str, payload: TestUpdate, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    validate_questions(payload)
    test = owned_test(db, test_id, user)
    existing_questions = {question.id: question for question in test.questions}
    seen_question_ids: set[str] = set()

    test.title = payload.title.strip()
    test.description = payload.description.strip() if payload.description else None
    test.form_mode = payload.form_mode
    test.is_public = payload.is_public
    settings = exam_settings(payload)
    test.time_limit_minutes, test.shuffle, test.verify_candidate_email = settings["time_limit_minutes"], settings["shuffle"], settings["verify_candidate_email"]

    for index, incoming in enumerate(payload.questions):
        if incoming.id:
            question = existing_questions.get(incoming.id)
            if not question:
                raise HTTPException(status_code=422, detail=f"Question {index + 1} does not belong to this test")
            seen_question_ids.add(question.id)
            question.position = index + 1
            question.question_type = incoming.question_type
            question.prompt = incoming.prompt.strip()
            question.options = [option.strip() for option in incoming.options if option.strip()] if incoming.question_type == QuestionType.multiple_choice else []
            question.correct_option_index = incoming.correct_option_index if incoming.question_type == QuestionType.multiple_choice else None
        else:
            db.add(build_question(test.id, index, incoming))

    removed_count = 0
    for question_id, question in existing_questions.items():
        if question_id not in seen_question_ids:
            db.delete(question)
            removed_count += 1

    audit(
        db,
        user,
        request,
        "test.updated",
        "test",
        test.id,
        None,
        {"question_count": len(payload.questions), "removed_questions": removed_count, "form_mode": payload.form_mode, "is_public": payload.is_public, **settings},
    )
    db.commit()
    test = owned_test(db, test_id, user)
    return test_to_detail(test, db, user)


@router.delete("/{test_id}", status_code=204)
def remove_test(test_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    test = owned_test(db, test_id, user)
    deleted_id = test.id
    delete_test(db, test)
    audit(db, user, request, "test.deleted", "test", deleted_id)
    db.commit()


@router.delete("/{test_id}/attempts/{attempt_id}", status_code=204)
def release_attempt(test_id: str, attempt_id: str, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Let someone who started and never submitted (a crashed browser, a lapsed limit) start again."""
    test = owned_test(db, test_id, user)
    attempt = db.scalar(select(ExamAttempt).where(ExamAttempt.id == parse_uuid(attempt_id, "Attempt not found"), ExamAttempt.test_id == test.id).with_for_update())
    if not attempt:
        raise HTTPException(status_code=404, detail="Attempt not found")
    if attempt.submitted_at:
        raise HTTPException(status_code=409, detail="This attempt has already been submitted")
    db.delete(attempt)
    audit(db, user, request, "test.attempt_released", "test", test.id, None, {"attempt_id": attempt.id})
    db.commit()


def public_test(db: Session, token: str) -> Test:
    test = db.scalar(
        select(Test)
        .options(selectinload(Test.questions))
        .where(Test.public_token == parse_uuid(token, "Test link is invalid or closed"), Test.is_public.is_(True))
    )
    if not test:
        raise HTTPException(status_code=404, detail="Test link is invalid or closed")
    return test


def already_submitted(db: Session, test_id: str, email: str) -> bool:
    return db.scalar(select(TestSubmission.id).where(TestSubmission.test_id == test_id, TestSubmission.session_id.is_(None), TestSubmission.participant_email == email)) is not None


@public_router.get("/{token}", response_model=TestOut)
def get_public_test(token: str, db: Session = Depends(get_db)):
    test = public_test(db, token)
    # An exam's questions come from POST .../start, so the link alone reveals nothing. A plain form has nothing to protect.
    return TestOut.from_test(test, include_questions=test.form_mode)


@public_router.post(
    "/{token}/start",
    response_model=ExamStarted,
    dependencies=[Depends(rate_limit("public-test-start", 20, 3600, "token"))],
)
def start_public_exam(token: str, payload: ExamStart, request: Request, db: Session = Depends(get_db)):
    """Begin an exam, or pick one up again: the same email gets the same clock and the same order, never a fresh start."""
    test = public_test(db, token)
    if test.form_mode:
        raise HTTPException(status_code=400, detail="A plain form has no start; fill it in and submit it")
    if test.verify_candidate_email:
        raise HTTPException(status_code=403, detail="This test checks the email first: ask for a code, then enter it")
    return begin_attempt(db, test, payload.participant_name, str(payload.participant_email).lower(), request, None)


def begin_attempt(db: Session, test: Test, name: str, email: str, request: Request, verified_at: datetime | None) -> ExamStarted:
    """The attempt for this email, written now or already there, and what the candidate is shown for it."""
    if already_submitted(db, test.id, email):
        raise HTTPException(status_code=409, detail="This email has already submitted this test")
    questions = list(test.questions)
    attempt = db.scalar(select(ExamAttempt).where(ExamAttempt.test_id == test.id, ExamAttempt.participant_email == email))
    if attempt is None:
        attempt = ExamAttempt(
            test_id=test.id,
            participant_name=name,
            participant_email=email,
            participant_ip=request_ip(request),
            layout=make_layout(questions, test.shuffle),
        )
        db.add(attempt)
        try:
            db.commit()
        except IntegrityError:  # the same person started twice at once: both end up on the one row
            db.rollback()
            attempt = db.scalar(select(ExamAttempt).where(ExamAttempt.test_id == test.id, ExamAttempt.participant_email == email))
    if attempt is None or attempt.submitted_at:
        raise HTTPException(status_code=409, detail="This email has already submitted this test")
    if verified_at:
        attempt.email_verified_at = verified_at
        db.commit()
    left = seconds_left(test, attempt, datetime.now(timezone.utc))
    if left == 0:
        raise HTTPException(status_code=400, detail="Time is up for this attempt. Ask the organiser if you need to start again")
    return ExamStarted(
        attempt=attempt.id,
        started_at=as_utc(attempt.started_at),
        participant_name=attempt.participant_name,
        seconds_left=left,
        questions=shown_questions(arrange(questions, attempt.layout)),
    )


def exam_that_checks_email(db: Session, token: str) -> Test:
    test = public_test(db, token)
    if test.form_mode:
        raise HTTPException(status_code=400, detail="A plain form has no start; fill it in and submit it")
    if not test.verify_candidate_email:
        raise HTTPException(status_code=409, detail="This test does not check the email")
    return test


@public_router.post(
    "/{token}/verification",
    response_model=ExamCodeSent,
    dependencies=[Depends(rate_limit("public-test-code", 10, 3600, "token"))],
)
def send_exam_code(token: str, payload: ExamCodeRequest, request: Request, db: Session = Depends(get_db)):
    """Email a one-time code to the address given. Sent inline so a delivery failure is reported, not hidden."""
    test = exam_that_checks_email(db, token)
    email = str(payload.participant_email).lower()
    if already_submitted(db, test.id, email):
        raise HTTPException(status_code=409, detail="This email has already submitted this test")
    code_row = db.scalar(select(ExamEmailCode).where(ExamEmailCode.test_id == test.id, ExamEmailCode.email == email))
    if code_row is None:
        code_row = ExamEmailCode(test_id=test.id, email=email)
        db.add(code_row)
        try:
            db.flush()
        except IntegrityError:  # two requests for the same address at once: both use the one row
            db.rollback()
            code_row = db.scalar(select(ExamEmailCode).where(ExamEmailCode.test_id == test.id, ExamEmailCode.email == email))
    now = datetime.now(timezone.utc)
    if code_row.verification_sends >= MAX_SENDS and code_row.verification_sent_at and now - as_utc(code_row.verification_sent_at) > timedelta(seconds=EXAM_SENDS_WINDOW_SECONDS):
        code_row.verification_sends = 0  # the cap is per hour here: nobody can lock an address out of an exam for good
    code = new_code(code_row, now, "Too many codes requested for this address. Try again in an hour.")
    db.commit()
    try:
        mailer.send_exam_code(email, test.title, code)
    except Exception:
        mailer.logger.exception("Exam code email for test %s could not be delivered", test.id)
        code_row.verification_code_hash = None
        code_row.verification_sent_at = None  # nothing arrived, so the candidate may retry straight away
        audit(db, None, request, "public_test.code_failed", "test", test.id)
        db.commit()
        raise HTTPException(status_code=502, detail="The code could not be sent. Try again or ask the organiser.") from None
    audit(db, None, request, "public_test.code_sent", "test", test.id, None, {"sends": code_row.verification_sends})
    db.commit()
    return ExamCodeSent(expires_in_seconds=CODE_TTL_SECONDS, resend_after_seconds=RESEND_COOLDOWN_SECONDS)


@public_router.post(
    "/{token}/verification/confirm",
    response_model=ExamStarted,
    dependencies=[Depends(rate_limit("public-test-confirm", 30, 600, "token"))],
)
def confirm_exam_code(token: str, payload: ExamCodeConfirm, request: Request, db: Session = Depends(get_db)):
    """The right code is the start: it begins the exam, or picks the attempt up again, in the same request."""
    test = exam_that_checks_email(db, token)
    email = str(payload.participant_email).lower()
    code_row = db.scalar(select(ExamEmailCode).where(ExamEmailCode.test_id == test.id, ExamEmailCode.email == email).with_for_update())
    if code_row is None:
        raise HTTPException(status_code=409, detail="No code was requested")
    if not check_code(code_row, payload.code):  # raises when no usable code exists
        locked = code_row.verification_attempts >= MAX_ATTEMPTS
        if locked:
            audit(db, None, request, "public_test.code_locked", "test", test.id)
        db.commit()
        raise HTTPException(status_code=429 if locked else 422, detail="Too many wrong attempts. Request a new code." if locked else "The code is incorrect")
    verified_at = code_row.verified_at
    audit(db, None, request, "public_test.code_verified", "test", test.id)
    db.commit()
    return begin_attempt(db, test, payload.participant_name, email, request, verified_at)


def open_attempt(db: Session, token: str | None, test: Test) -> ExamAttempt:
    """The unsubmitted attempt this token names for this test, locked so two submissions cannot both take it."""
    try:
        attempt_id = str(uuid.UUID(token or ""))
    except ValueError:
        raise HTTPException(status_code=400, detail="Start the test before submitting it") from None
    attempt = db.scalar(select(ExamAttempt).where(ExamAttempt.id == attempt_id, ExamAttempt.test_id == test.id).with_for_update())
    if attempt is None:
        raise HTTPException(status_code=400, detail="Start the test before submitting it")
    if attempt.submitted_at:
        raise HTTPException(status_code=409, detail="This email has already submitted this test")
    return attempt


@public_router.post(
    "/{token}/submissions",
    response_model=TestSubmissionOut,
    status_code=201,
    dependencies=[Depends(rate_limit("public-test-submit", 10, 3600, "token"))],
)
def submit_public_test(token: str, payload: PublicTestSubmit, request: Request, db: Session = Depends(get_db)):
    test = public_test(db, token)
    questions = list(db.scalars(select(TestQuestion).where(TestQuestion.test_id == test.id).order_by(TestQuestion.position)).all())
    name, email = payload.participant_name, str(payload.participant_email).lower() if payload.participant_email else None
    attempt, answers, started_at, over_limit, verified_at = None, payload.answers, None, None, None
    if not test.form_mode:
        # Who sat the exam is who started it, whatever the request body says; the answers are the options as they were shown.
        attempt = open_attempt(db, payload.attempt, test)
        name, email = attempt.participant_name, attempt.participant_email
        answers = original_answers(arrange(questions, attempt.layout), payload.answers)
        started_at, over_limit, verified_at = attempt.started_at, over_limit_seconds(test, attempt, datetime.now(timezone.utc)), attempt.email_verified_at
    if email and already_submitted(db, test.id, email):
        raise HTTPException(status_code=409, detail="This email has already submitted this test")
    checked_answers, score, total = grade_answers(questions, answers)
    submission = TestSubmission(
        session_id=None,
        test_id=test.id,
        participant_name=name.strip() if name else None,
        participant_email=email,
        participant_ip=request_ip(request),
        answers=checked_answers,
        score=score,
        total=total,
        # Plain forms are not monitored: anything a client sends for one is dropped, not stored.
        integrity_events=[] if test.form_mode else [stored_exam_event(event) for event in payload.events],
        started_at=started_at,
        over_limit_seconds=over_limit,
        email_verified_at=verified_at,
    )
    db.add(submission)
    if attempt is not None:
        attempt.submitted_at = datetime.now(timezone.utc)
    audit(db, None, request, "public_test.submitted", "test_submission", submission.id, None, {"test_id": test.id, "score": score, "total": total, "form_mode": test.form_mode})
    db.commit()
    db.refresh(submission)
    return TestSubmissionOut.model_validate(submission)
