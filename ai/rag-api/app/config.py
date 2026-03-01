from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ollama_url: str = "http://ollama:11434"
    qdrant_url: str = "http://qdrant:6333"
    database_url: str = ""
    finance_doc_root: str = "/data/finance"
    llm_model: str = "qwen2.5:7b-instruct"
    embed_model: str = "nomic-embed-text"
    qdrant_collection: str = "fintech_rag"           # legacy — kept for migration cleanup
    qdrant_collection_db: str = "fintech_rag_db"     # live database records
    qdrant_collection_docs: str = "fintech_rag_docs" # uploaded document chunks
    qdrant_collection_learned: str = "fintech_rag_learned"  # saved ChatGPT Q&A pairs
    db_sync_interval_seconds: int = 3600
    rag_api_key: str = ""  # set RAG_API_KEY env var to require auth on /v1/ endpoints

    class Config:
        env_file = ".env"


settings = Settings()
