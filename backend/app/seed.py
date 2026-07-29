from sqlalchemy import select

from .config import get_settings
from .database import Base, SessionLocal, engine
from .models import User
from .migrations import run_lightweight_migrations
from .security import hash_password


def seed() -> None:
    settings = get_settings()
    Base.metadata.create_all(bind=engine)
    run_lightweight_migrations()
    with SessionLocal() as db:
        if not db.scalar(select(User).where(User.email == settings.initial_admin_email.lower())):
            db.add(User(email=settings.initial_admin_email.lower(), full_name="HR Administrator", role="admin", password_hash=hash_password(settings.initial_admin_password)))
            db.commit()
            print(f"Created initial HR user: {settings.initial_admin_email}")


if __name__ == "__main__":
    seed()
