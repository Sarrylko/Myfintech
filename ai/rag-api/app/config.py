from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ollama_url: str = "http://ollama:11434"
    qdrant_url: str = "http://qdrant:6333"
    database_url: str = ""
    finance_doc_root: str = "/data/finance"
    llm_model: str = "qwen2.5:7b-instruct"
    embed_model: str = "nomic-embed-text"
    qdrant_collection: str = "fintech_rag"
    db_sync_interval_seconds: int = 3600

    class Config:
        env_file = ".env"


settings = Settings()
