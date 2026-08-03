from app.test_generator import generate_questions


def test_imports_ten_numbered_multiple_choice_questions_with_answer_key():
    text = """
    Nemo Call sample assessment

    1. What does Nemo Call show to the host?
    A. Automatic rejection
    B. Neutral activity signals
    C. Personality score
    D. Lie detection

    2. Who reviews the signals?
    A. Human host
    B. Browser
    C. Camera driver
    D. Email server

    3. What happens when a participant changes tab?
    A. The candidate is rejected
    B. A neutral event is logged
    C. The test is deleted
    D. The password changes

    4. Which action can be shown as a test signal?
    A. Copy paste
    B. Favorite color
    C. Personality type
    D. Mood

    5. What should happen before monitoring?
    A. Consent
    B. Automatic verdict
    C. Payment
    D. Password reset

    6. What page does a participant use?
    A. Admin dashboard
    B. Join link
    C. Audit settings
    D. Database shell

    7. What can host edit after generating a test?
    A. Questions and options
    B. Browser source code
    C. Candidate laptop
    D. Network router

    8. Which status is neutral?
    A. Cheater
    B. Requires review
    C. Guilty
    D. Blocked forever

    9. What does the audit log record?
    A. Host actions
    B. Candidate emotions
    C. Private passwords
    D. Voice personality

    10. What should happen after the retention period?
    A. Data is kept forever
    B. Data is deleted
    C. Candidate is rejected
    D. Questions are hidden

    Answer Key:
    1. B 2. A 3. B 4. A 5. A
    6. B 7. A 8. B 9. A 10. B
    """

    questions = generate_questions(text, question_count=10)

    assert len(questions) == 10
    assert questions[0].prompt == "What does Nemo Call show to the host?"
    assert questions[0].correct_option_index == 1
    assert questions[9].prompt == "What should happen after the retention period?"
    assert questions[9].correct_option_index == 1
