from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://autofeature:autofeature@db:5432/autofeature"
    REDIS_URL: str = "redis://redis:6379/0"
    UPLOAD_DIR: str = "./uploads"
    PIPELINE_DIR: str = "./pipelines"
    MAX_UPLOAD_SIZE: int = 200 * 1024 * 1024

    @property
    def CELERY_BROKER_URL(self) -> str:
        return self.REDIS_URL

    @property
    def CELERY_RESULT_BACKEND(self) -> str:
        return self.REDIS_URL

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
