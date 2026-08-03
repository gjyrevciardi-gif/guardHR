from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import InterviewSession, Test, TestQuestion, TestSubmission, User
from ..schemas import (
    PublicTestSubmit,
    TestCreate,
    TestDetailOut,
    TestOut,
    TestQuestionHostOut,
    TestQuestionOut,
    TestReviewSessionOut,
    TestStandaloneSubmissionOut,
    TestSubmissionOut,
    TestUpdate,
)
from ..security import get_current_user
from ..services import audit, request_ip
from ..test_generator import extract_text_from_upload, generate_questions, infer_title

router = APIRouter(prefix="/tests", tags=["tests"])
public_router = APIRouter(prefix="/public/tests", tags=["public-tests"])


def test_to_out(test: Test, include_questions: bool = True) -> TestOut:
    return TestOut(
        id=test.id,
        public_token=test.public_token,
        title=test.title,
        description=test.description,
        is_public=test.is_public,
        form_mode=test.form_mode,
        created_at=test.created_at,
        question_count=len(test.questions),
        questions=[
            TestQuestionOut(id=q.id, position=q.position, question_type=q.question_type, prompt=q.prompt, options=q.options)
            for q in test.questions
        ] if include_questions else [],
    )


def owned_test(db: Session, test_id: str, user: User) -> Test:
    test = db.scalar(
        select(Test)
        .options(selectinload(Test.questions))
        .where(Test.id == test_id, Test.created_by == user.id)
    )
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    return test


def validate_questions(payload: TestCreate | TestUpdate) -> None:
    for index, question in enumerate(payload.questions):
        if question.question_type == "short_text":
            continue
        cleaned_options = [option.strip() for option in question.options if option.strip()]
        if len(cleaned_options) < 2:
            raise HTTPException(status_code=422, detail=f"Question {index + 1} needs at least 2 options")
        if question.correct_option_index is None and not payload.form_mode:
            raise HTTPException(status_code=422, detail=f"Correct answer is required for question {index + 1}")
        if question.correct_option_index is not None and question.correct_option_index >= len(cleaned_options):
            raise HTTPException(status_code=422, detail=f"Correct answer is invalid for question {index + 1}")


def build_question(test_id: str, index: int, question) -> TestQuestion:
    options = [option.strip() for option in question.options if option.strip()] if question.question_type == "multiple_choice" else []
    return TestQuestion(
        test_id=test_id,
        position=index + 1,
        question_type=question.question_type,
        prompt=question.prompt.strip(),
        options=options,
        correct_option_index=question.correct_option_index if question.question_type == "multiple_choice" else None,
    )


def grade_answers(questions: list[TestQuestion], answers: dict) -> tuple[dict, int, int]:
    checked_answers: dict = {}
    score = 0
    total = 0
    for question in questions:
        answer = answers.get(question.id)
        if question.question_type == "short_text":
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


def test_to_detail(test: Test, db: Session, user: User) -> TestDetailOut:
    sessions = db.scalars(
        select(InterviewSession)
        .options(selectinload(InterviewSession.candidate), selectinload(InterviewSession.events))
        .where(InterviewSession.created_by == user.id, InterviewSession.test_id == test.id)
        .order_by(InterviewSession.created_at.desc())
    ).all()
    session_ids = [session.id for session in sessions]
    submissions = []
    if session_ids:
        submissions = db.scalars(select(TestSubmission).where(TestSubmission.session_id.in_(session_ids))).all()
    submissions_by_session = {submission.session_id: submission for submission in submissions}

    review_sessions: list[TestReviewSessionOut] = []
    for session in sessions:
        event_summary: dict[str, int] = {}
        for event in session.events:
            event_summary[event.event_type] = event_summary.get(event.event_type, 0) + 1
        submission = submissions_by_session.get(session.id)
        review_sessions.append(
            TestReviewSessionOut(
                session_id=session.id,
                session_title=session.title,
                candidate_name=session.candidate.full_name,
                candidate_email=session.candidate.email,
                status=session.status,
                review_status=session.review_status,
                event_count=len(session.events),
                event_summary=event_summary,
                submitted_at=submission.submitted_at if submission else None,
                score=submission.score if submission else None,
                total=submission.total if submission else None,
                answers=submission.answers if submission else None,
            )
        )

    return TestDetailOut(
        id=test.id,
        public_token=test.public_token,
        title=test.title,
        description=test.description,
        is_public=test.is_public,
        form_mode=test.form_mode,
        created_at=test.created_at,
        question_count=len(test.questions),
        questions=[
            TestQuestionHostOut(
                id=question.id,
                position=question.position,
                question_type=question.question_type,
                prompt=question.prompt,
                options=question.options,
                correct_option_index=question.correct_option_index,
            )
            for question in test.questions
        ],
        sessions=review_sessions,
        standalone_submissions=[
            TestStandaloneSubmissionOut(
                id=submission.id,
                participant_name=submission.participant_name,
                participant_email=submission.participant_email,
                score=submission.score,
                total=submission.total,
                answers=submission.answers,
                submitted_at=submission.submitted_at,
            )
            for submission in db.scalars(
                select(TestSubmission)
                .where(TestSubmission.test_id == test.id, TestSubmission.session_id.is_(None))
                .order_by(TestSubmission.submitted_at.desc())
            ).all()
        ],
    )


@router.get("", response_model=list[TestOut])
def list_tests(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.scalars(
        select(Test)
        .options(selectinload(Test.questions))
        .where(Test.created_by == user.id)
        .order_by(Test.created_at.desc())
    ).all()
    return [test_to_out(row, include_questions=False) for row in rows]


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
    return test_to_out(test)


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
            question_type="multiple_choice",
            prompt=question.prompt,
            options=question.options,
            correct_option_index=question.correct_option_index,
        ))
    audit(db, user, request, "test.generated_from_file", "test", test.id, None, {"filename": file.filename, "question_count": len(questions)})
    db.commit()
    db.refresh(test)
    test = db.scalar(select(Test).options(selectinload(Test.questions)).where(Test.id == test.id))
    return test_to_out(test)


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
            question.options = [option.strip() for option in incoming.options if option.strip()] if incoming.question_type == "multiple_choice" else []
            question.correct_option_index = incoming.correct_option_index if incoming.question_type == "multiple_choice" else None
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


def public_test(db: Session, token: str) -> Test:
    test = db.scalar(
        select(Test)
        .options(selectinload(Test.questions))
        .where(Test.public_token == token, Test.is_public.is_(True))
    )
    if not test:
        raise HTTPException(status_code=404, detail="Test link is invalid or closed")
    return test


@public_router.get("/{token}", response_model=TestOut)
def get_public_test(token: str, db: Session = Depends(get_db)):
    return test_to_out(public_test(db, token), include_questions=True)


@public_router.post("/{token}/submissions", response_model=TestSubmissionOut, status_code=201)
def submit_public_test(token: str, payload: PublicTestSubmit, request: Request, db: Session = Depends(get_db)):
    test = public_test(db, token)
    questions = db.scalars(select(TestQuestion).where(TestQuestion.test_id == test.id).order_by(TestQuestion.position)).all()
    checked_answers, score, total = grade_answers(list(questions), payload.answers)
    submission = TestSubmission(
        session_id=None,
        test_id=test.id,
        participant_name=payload.participant_name.strip() if payload.participant_name else None,
        participant_email=str(payload.participant_email).lower() if payload.participant_email else None,
        participant_ip=request_ip(request),
        answers=checked_answers,
        score=score,
        total=total,
    )
    db.add(submission)
    audit(
        db,
        None,
        request,
        "public_test.submitted",
        "test_submission",
        submission.id,
        None,
        {"test_id": test.id, "score": score, "total": total, "form_mode": test.form_mode},
    )
    db.commit()
    db.refresh(submission)
    return TestSubmissionOut(
        id=submission.id,
        test_id=submission.test_id,
        session_id=submission.session_id,
        participant_name=submission.participant_name,
        participant_email=submission.participant_email,
        score=submission.score,
        total=submission.total,
        answers=submission.answers,
        submitted_at=submission.submitted_at,
    )
