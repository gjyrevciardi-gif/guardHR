from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..enums import QuestionType
from ..models import IntegrityEvent, InterviewSession, Test, TestQuestion, TestSubmission, User
from ..ratelimit import rate_limit
from ..retention import delete_test
from ..schemas import (
    ExamEventCreate,
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
from ..signals import severity_for
from ..test_generator import extract_text_from_upload, generate_questions, infer_title

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
    return TestDetailOut(
        **TestOut.from_test(test, include_questions=False).model_dump(exclude={"questions"}),
        questions=[TestQuestionHostOut.model_validate(question) for question in test.questions],
        sessions=review_sessions,
        standalone_submissions=[TestStandaloneSubmissionOut.model_validate(submission) for submission in standalone],
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

    test = Test(created_by=user.id, title=payload.title, description=payload.description, form_mode=payload.form_mode, is_public=payload.is_public)
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
        {"question_count": len(payload.questions), "removed_questions": removed_count, "form_mode": payload.form_mode, "is_public": payload.is_public},
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


def public_test(db: Session, token: str) -> Test:
    test = db.scalar(
        select(Test)
        .options(selectinload(Test.questions))
        .where(Test.public_token == parse_uuid(token, "Test link is invalid or closed"), Test.is_public.is_(True))
    )
    if not test:
        raise HTTPException(status_code=404, detail="Test link is invalid or closed")
    return test


@public_router.get("/{token}", response_model=TestOut)
def get_public_test(token: str, db: Session = Depends(get_db)):
    return TestOut.from_test(public_test(db, token))


@public_router.post(
    "/{token}/submissions",
    response_model=TestSubmissionOut,
    status_code=201,
    dependencies=[Depends(rate_limit("public-test-submit", 10, 3600, "token"))],
)
def submit_public_test(token: str, payload: PublicTestSubmit, request: Request, db: Session = Depends(get_db)):
    test = public_test(db, token)
    email = str(payload.participant_email).lower() if payload.participant_email else None
    if email and db.scalar(select(TestSubmission.id).where(TestSubmission.test_id == test.id, TestSubmission.session_id.is_(None), TestSubmission.participant_email == email)):
        raise HTTPException(status_code=409, detail="This email has already submitted this test")
    questions = db.scalars(select(TestQuestion).where(TestQuestion.test_id == test.id).order_by(TestQuestion.position)).all()
    checked_answers, score, total = grade_answers(list(questions), payload.answers)
    submission = TestSubmission(
        session_id=None,
        test_id=test.id,
        participant_name=payload.participant_name.strip() if payload.participant_name else None,
        participant_email=email,
        participant_ip=request_ip(request),
        answers=checked_answers,
        score=score,
        total=total,
        # Plain forms are not monitored: anything a client sends for one is dropped, not stored.
        integrity_events=[] if test.form_mode else [stored_exam_event(event) for event in payload.events],
    )
    db.add(submission)
    audit(db, None, request, "public_test.submitted", "test_submission", submission.id, None, {"test_id": test.id, "score": score, "total": total, "form_mode": test.form_mode})
    db.commit()
    db.refresh(submission)
    return TestSubmissionOut.model_validate(submission)
