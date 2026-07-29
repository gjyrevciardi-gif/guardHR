from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Nemo Call API"
    database_url: str = "sqlite:///./interviewguard.db"
    jwt_secret: str = "development-only-secret-change-me-now"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480
    cors_origins: str = "http://localhost:3100"
    initial_admin_email: str = "hr@example.com"
    initial_admin_password: str = "ChangeMe123!"
    yolo_model_path: str = "yolo11n.pt"
    public_app_url: str = "http://localhost:3100"
    smtp_host: str = "mailpit"
    smtp_port: int = 1025
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = "Nemo Call <no-reply@nemocall.test>"
    smtp_use_tls: bool = False

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
