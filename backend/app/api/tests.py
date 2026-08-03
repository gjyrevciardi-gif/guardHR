from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import InterviewSession, Test, TestQuestion, TestSubmission, User
from ..schemas import TestCreate, TestDetailOut, TestOut, TestQuestionHostOut, TestQuestionOut, TestReviewSessionOut, TestUpdate
from ..security import get_current_user
from ..services import audit
from ..test_generator import extract_text_from_upload, generate_questions, infer_title

router = APIRouter(prefix="/tests", tags=["tests"])


def test_to_out(test: Test, include_questions: bool = True) -> TestOut:
    return TestOut(
        id=test.id,
        title=test.title,
        description=test.description,
        created_at=test.created_at,
        question_count=len(test.questions),
        questions=[
            TestQuestionOut(id=q.id, position=q.position, prompt=q.prompt, options=q.options)
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
        cleaned_options = [option.strip() for option in question.options if option.strip()]
        if len(cleaned_options) < 2:
            raise HTTPException(status_code=422, detail=f"Question {index + 1} needs at least 2 options")
        if question.correct_option_index >= len(cleaned_options):
            raise HTTPException(status_code=422, detail=f"Correct answer is invalid for question {index + 1}")


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
        title=test.title,
        description=test.description,
        created_at=test.created_at,
        question_count=len(test.questions),
        questions=[
            TestQuestionHostOut(
                id=question.id,
                position=question.position,
                prompt=question.prompt,
                options=question.options,
                correct_option_index=question.correct_option_index,
            )
            for question in test.questions
        ],
        sessions=review_sessions,
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

    test = Test(created_by=user.id, title=payload.title, description=payload.description)
    db.add(test)
    db.flush()
    for index, question in enumerate(payload.questions):
        options = [option.strip() for option in question.options if option.strip()]
        db.add(TestQuestion(test_id=test.id, position=index + 1, prompt=question.prompt.strip(), options=options, correct_option_index=question.correct_option_index))
    audit(db, user, request, "test.created", "test", test.id, None, {"question_count": len(payload.questions)})
    db.commit()
    db.refresh(test)
    test = db.scalar(select(Test).options(selectinload(Test.questions)).where(Test.id == test.id))
    return test_to_out(test)


@router.post("/generate-from-file", response_model=TestOut, status_code=201)
async def generate_test_from_file(
    request: Request,
    file: UploadFile = File(...),
    question_count: int = Form(8),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if question_count < 2 or question_count > 30:
        raise HTTPException(status_code=422, detail="Question count must be between 2 and 30")
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
    )
    db.add(test)
    db.flush()
    for index, question in enumerate(questions):
        db.add(TestQuestion(
            test_id=test.id,
            position=index + 1,
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

    for index, incoming in enumerate(payload.questions):
        options = [option.strip() for option in incoming.options if option.strip()]
        if incoming.id:
            question = existing_questions.get(incoming.id)
            if not question:
                raise HTTPException(status_code=422, detail=f"Question {index + 1} does not belong to this test")
            seen_question_ids.add(question.id)
            question.position = index + 1
            question.prompt = incoming.prompt.strip()
            question.options = options
            question.correct_option_index = incoming.correct_option_index
        else:
            question = TestQuestion(
                test_id=test.id,
                position=index + 1,
                prompt=incoming.prompt.strip(),
                options=options,
                correct_option_index=incoming.correct_option_index,
            )
            db.add(question)

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
        {"question_count": len(payload.questions), "removed_questions": removed_count},
    )
    db.commit()
    test = owned_test(db, test_id, user)
    return test_to_detail(test, db, user)
