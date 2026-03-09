from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ollama_url: str = "http://ollama:11434"
    qdrant_url: str = "http://qdrant:6333"
    database_url: str = ""
    finance_doc_root: str = "/data/finance"
    embed_model: str = "nomic-embed-text"
    qdrant_collection_db: str = "fintech_rag_db"
    qdrant_collection_docs: str = "fintech_rag_docs"
    db_sync_interval_seconds: int = 3600
    file_reconcile_interval_seconds: int = 3600
    file_watch_enabled: bool = True
    file_watcher_observer: str = "polling"  # polling | inotify
    ingest_api_key: str = ""  # if set, POST endpoints require X-Ingest-Api-Key header

    class Config:
        env_file = ".env"


settings = Settings()
