from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Test, TestQuestion, User
from ..schemas import TestCreate, TestOut, TestQuestionOut
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
    for index, question in enumerate(payload.questions):
      if question.correct_option_index >= len(question.options):
          raise HTTPException(status_code=422, detail=f"Correct answer is invalid for question {index + 1}")

    test = Test(created_by=user.id, title=payload.title, description=payload.description)
    db.add(test)
    db.flush()
    for index, question in enumerate(payload.questions):
        db.add(TestQuestion(test_id=test.id, position=index + 1, prompt=question.prompt, options=question.options, correct_option_index=question.correct_option_index))
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
