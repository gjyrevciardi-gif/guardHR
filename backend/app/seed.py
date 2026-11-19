from sqlalchemy import select

from .config import get_settings
from .database import Base, SessionLocal, engine
from .models import User
from .security import hash_password


def seed() -> None:
    settings = get_settings()
    if engine.dialect.name == "sqlite":  # PostgreSQL schemas come from `alembic upgrade head`
        Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        if not db.scalar(select(User).where(User.email == settings.initial_admin_email.lower())):
            db.add(User(email=settings.initial_admin_email.lower(), full_name="HR Administrator", role="admin", password_hash=hash_password(settings.initial_admin_password)))
            db.commit()
            print(f"Created initial HR user: {settings.initial_admin_email}")


if __name__ == "__main__":
    seed()
