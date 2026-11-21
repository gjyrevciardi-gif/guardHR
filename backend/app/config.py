import json
from functools import lru_cache
from urllib.parse import urlparse

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_ADMIN_PASSWORD = "ChangeMe123!"
PLACEHOLDER_SECRET_PREFIXES = ("replace-with", "development-only")


class Settings(BaseSettings):
    app_name: str = "NemoGuardHR API"
    app_env: str = "development"
    database_url: str = "sqlite:///./nemoguard.db"
    jwt_secret: str = "development-only-secret-change-me-now"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480
    session_cookie_name: str = "nemoguard_session"
    cors_origins: str = "http://localhost:3100"
    initial_admin_email: str = "hr@example.com"
    initial_admin_password: str = DEFAULT_ADMIN_PASSWORD
    # None = open registration in development, closed in production.
    registration_enabled: bool | None = None
    # None = administrators must use two-step verification in production, optional in development.
    require_admin_mfa: bool | None = None
    # Only enable behind a reverse proxy that overwrites X-Forwarded-For.
    trust_proxy_headers: bool = False
    rate_limit_enabled: bool = True
    # 0 disables the in-process scheduled retention purge.
    retention_purge_interval_hours: int = 24
    # A call still `in_progress` this long after it started is treated as abandoned (tab closed, no /finish) and closed.
    abandoned_session_hours: int = 12
    ice_servers: str = '[{"urls": "stun:stun.l.google.com:19302"}]'
    yolo_model_path: str = "yolo11n.pt"
    public_app_url: str = "http://localhost:3100"
    smtp_host: str = "mailpit"
    smtp_port: int = 1025
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = "NemoGuardHR <no-reply@nemoguard.test>"
    smtp_use_tls: bool = False

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @field_validator("registration_enabled", "require_admin_mfa", "ice_servers", mode="before")
    @classmethod
    def blank_means_default(cls, value, info):
        """docker compose passes unset variables as empty strings; treat them as 'not configured'."""
        if isinstance(value, str) and not value.strip():
            return cls.model_fields[info.field_name].default
        return value

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    @property
    def registration_allowed(self) -> bool:
        return self.registration_enabled if self.registration_enabled is not None else not self.is_production

    @property
    def admin_mfa_required(self) -> bool:
        return self.require_admin_mfa if self.require_admin_mfa is not None else self.is_production

    @property
    def cookie_secure(self) -> bool:
        return self.is_production or self.public_app_url.startswith("https://")

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def allowed_origins(self) -> set[str]:
        parsed = urlparse(self.public_app_url)
        origins = set(self.cors_origin_list)
        if parsed.scheme and parsed.netloc:
            origins.add(f"{parsed.scheme}://{parsed.netloc}")
        return origins

    @property
    def ice_server_list(self) -> list[dict]:
        return json.loads(self.ice_servers)

    @model_validator(mode="after")
    def validate_settings(self) -> "Settings":
        try:
            servers = json.loads(self.ice_servers)
        except json.JSONDecodeError as exc:
            raise ValueError("ICE_SERVERS must be valid JSON") from exc
        if not isinstance(servers, list) or not all(isinstance(item, dict) and "urls" in item for item in servers):
            raise ValueError('ICE_SERVERS must be a JSON list of objects like {"urls": "stun:host:3478"}')

        if self.is_production:
            problems = []
            if len(self.jwt_secret) < 32 or self.jwt_secret.startswith(PLACEHOLDER_SECRET_PREFIXES):
                problems.append("JWT_SECRET must be a random value of at least 32 characters")
            if self.initial_admin_password == DEFAULT_ADMIN_PASSWORD:
                problems.append("INITIAL_ADMIN_PASSWORD must not be the default")
            if not self.public_app_url.startswith("https://"):
                problems.append("PUBLIC_APP_URL must use https (camera, microphone and screen share require it)")
            if problems:
                raise ValueError("Insecure production configuration: " + "; ".join(problems))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
