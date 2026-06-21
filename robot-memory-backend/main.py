import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


def sanitize_no_proxy() -> None:
    """Work around current httpx/proxy env incompatibility in this runtime."""
    os.environ.pop("NO_PROXY", None)
    os.environ.pop("no_proxy", None)


sanitize_no_proxy()

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from mem0 import Memory


logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("robot-memory-backend")


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def env_list(name: str, default: str) -> List[str]:
    raw = os.getenv(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def build_ssl_config() -> Dict[str, Optional[str]]:
    certfile = os.getenv("SSL_CERTFILE", "").strip() or None
    keyfile = os.getenv("SSL_KEYFILE", "").strip() or None
    if bool(certfile) != bool(keyfile):
        raise RuntimeError("SSL_CERTFILE 和 SSL_KEYFILE 必须同时配置，或同时留空。")
    return {
        "certfile": certfile,
        "keyfile": keyfile,
        "enabled": bool(certfile and keyfile),
    }


def ensure_data_dirs() -> None:
    (BASE_DIR / "data").mkdir(parents=True, exist_ok=True)


def build_mem0_config() -> Dict[str, Any]:
    ensure_data_dirs()

    embedder_provider = os.getenv("MEM0_EMBEDDER_PROVIDER", "huggingface").strip().lower()
    llm_provider = os.getenv("MEM0_LLM_PROVIDER", "openai").strip().lower()
    vector_provider = os.getenv("MEM0_VECTOR_PROVIDER", "qdrant").strip().lower()

    if vector_provider != "qdrant":
        raise RuntimeError("当前实现仅验证并支持 qdrant 本地模式，请将 MEM0_VECTOR_PROVIDER 设置为 qdrant。")

    if embedder_provider == "huggingface":
        embedder_model = os.getenv(
            "MEM0_EMBEDDER_MODEL",
            "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        )
        embedding_dims = int(os.getenv("MEM0_EMBEDDING_DIMS", "384"))
        embedder_config: Dict[str, Any] = {
            "provider": "huggingface",
            "config": {
                "model": embedder_model,
                "embedding_dims": embedding_dims,
                "model_kwargs": {"device": os.getenv("MEM0_EMBEDDER_DEVICE", "cpu")},
            },
        }
    elif embedder_provider == "openai":
        embedder_model = os.getenv("MEM0_EMBEDDER_MODEL", "text-embedding-3-small")
        embedding_dims = int(os.getenv("MEM0_EMBEDDING_DIMS", "1536"))
        openai_base_url = os.getenv("MEM0_OPENAI_BASE_URL") or os.getenv("OPENAI_BASE_URL")
        openai_api_key = os.getenv("MEM0_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
        embedder_config = {
            "provider": "openai",
            "config": {
                "model": embedder_model,
                "embedding_dims": embedding_dims,
                "openai_base_url": openai_base_url,
                "api_key": openai_api_key,
            },
        }
    else:
        raise RuntimeError(f"不支持的 MEM0_EMBEDDER_PROVIDER: {embedder_provider}")

    config = {
        "vector_store": {
            "provider": "qdrant",
            "config": {
                "collection_name": os.getenv("MEM0_COLLECTION_NAME", "robot_led_memory"),
                "path": os.getenv("MEM0_VECTOR_PATH", str(BASE_DIR / "data" / "qdrant")),
                "embedding_model_dims": embedding_dims,
                "on_disk": env_bool("MEM0_QDRANT_ON_DISK", True),
            },
        },
        "embedder": embedder_config,
        "history_db_path": os.getenv("MEM0_HISTORY_DB_PATH", str(BASE_DIR / "data" / "history.db")),
        "version": os.getenv("MEM0_VERSION", "v1.1"),
    }

    if env_bool("MEM0_INFER", False):
        if llm_provider == "ollama":
            config["llm"] = {
                "provider": "ollama",
                "config": {
                    "model": os.getenv("MEM0_LLM_MODEL", "llama3.1:8b"),
                    "ollama_base_url": os.getenv("MEM0_OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
                    "temperature": float(os.getenv("MEM0_LLM_TEMPERATURE", "0.1")),
                },
            }
        else:
            config["llm"] = {
                "provider": "openai",
                "config": {
                    "model": os.getenv("MEM0_LLM_MODEL", "gpt-4o-mini"),
                    "openai_base_url": os.getenv("MEM0_OPENAI_BASE_URL") or os.getenv("OPENAI_BASE_URL"),
                    "api_key": os.getenv("MEM0_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY"),
                    "temperature": float(os.getenv("MEM0_LLM_TEMPERATURE", "0.1")),
                },
            }
    else:
        # mem0ai==2.0.4 always initializes an LLM in AsyncMemory.__init__.
        # If llm is omitted, MemoryConfig defaults to provider="openai" with no api_key,
        # and OpenAILLM immediately creates openai.OpenAI(api_key=None), causing
        # openai.OpenAIError: Missing credentials even when infer=False.
        # The dummy key is only used to satisfy OpenAI client construction; calls with
        # infer=False skip LLM inference.
        config["llm"] = {
            "provider": "openai",
            "config": {
                "api_key": os.getenv("MEM0_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY") or "dummy",
            },
        }

    return config


class MemoryAddRequest(BaseModel):
    user_id: str = Field(..., min_length=1, description="用户唯一标识")
    user_text: str = Field(..., min_length=1, description="用户本轮说的话")
    bot_text: str = Field(..., min_length=1, description="模型本轮回复")
    infer: Optional[bool] = Field(None, description="是否启用 Mem0 事实抽取")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="附加元数据")


class MemorySearchRequest(BaseModel):
    user_id: str = Field(..., min_length=1, description="用户唯一标识")
    query: str = Field("", description="当前查询；为空时返回近期记忆摘要")
    top_k: int = Field(5, ge=1, le=20, description="返回记忆条数")


class MemoryService:
    def __init__(self) -> None:
        self.config = build_mem0_config()
        self.memory = Memory.from_config(self.config)
        self.default_infer = env_bool("MEM0_INFER", False)
        self.max_summary_chars = int(os.getenv("MEM0_SUMMARY_MAX_CHARS", "1200"))
        logger.info(
            "Mem0 initialized | vector=%s | embedder=%s | infer=%s",
            self.config["vector_store"]["provider"],
            self.config["embedder"]["provider"],
            self.default_infer,
        )

    async def _run_blocking(self, fn, *args, **kwargs):
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))

    async def add_turn(self, payload: MemoryAddRequest) -> Dict[str, Any]:
        infer = self.default_infer if payload.infer is None else payload.infer
        metadata = {
            "source": "doubao-realtime-frontend",
            **payload.metadata,
        }
        messages = [
            {"role": "user", "content": payload.user_text.strip()},
            {"role": "assistant", "content": payload.bot_text.strip()},
        ]
        result = await self._run_blocking(
            self.memory.add,
            messages,
            user_id=payload.user_id,
            metadata=metadata,
            infer=infer,
        )
        return {
            "ok": True,
            "infer": infer,
            "stored_count": len(result.get("results", [])),
            "results": result.get("results", []),
        }

    async def search_memories(self, payload: MemorySearchRequest) -> Dict[str, Any]:
        filters = {"user_id": payload.user_id}
        query = payload.query.strip()

        if query:
            result = await self._run_blocking(self.memory.search, query, filters=filters, top_k=payload.top_k)
        else:
            result = await self._run_blocking(self.memory.get_all, filters=filters, top_k=payload.top_k)

        memories = result.get("results", [])
        summary = self._build_summary(memories, query=query)
        return {
            "ok": True,
            "query": query,
            "count": len(memories),
            "summary_text": summary,
            "results": memories,
        }

    async def get_all_memories(self, user_id: str, top_k: int) -> Dict[str, Any]:
        result = await self._run_blocking(self.memory.get_all, filters={"user_id": user_id}, top_k=top_k)
        memories = result.get("results", [])
        return {
            "ok": True,
            "count": len(memories),
            "results": memories,
        }

    def _build_summary(self, memories: List[Dict[str, Any]], query: str) -> str:
        if not memories:
            if query:
                return "暂无与当前问题直接相关的长期记忆。"
            return "当前还没有可用的长期记忆。"

        header = "以下是和当前对话可能相关的长期记忆，请仅在自然相关时使用：" if query else "以下是当前已保存的近期长期记忆："
        lines: List[str] = [header]
        current_len = len(header)

        for idx, item in enumerate(memories, start=1):
            role = item.get("role") or item.get("metadata", {}).get("role") or "memory"
            text = (item.get("memory") or "").strip().replace("\n", " ")
            if not text:
                continue
            score = item.get("score")
            score_text = f"｜相关度 {score:.2f}" if isinstance(score, (int, float)) else ""
            line = f"{idx}. [{role}] {text}{score_text}"
            if current_len + len(line) + 1 > self.max_summary_chars:
                break
            lines.append(line)
            current_len += len(line) + 1

        return "\n".join(lines)


memory_service: Optional[MemoryService] = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global memory_service
    memory_service = MemoryService()
    yield


app = FastAPI(
    title="Robot LED Face Memory Backend",
    version="1.0.0",
    summary="基于 Mem0 的本地长期记忆后端",
    lifespan=lifespan,
)

cors_allow_origins = env_list("ALLOW_ORIGINS", "*")
cors_allow_methods = env_list("ALLOW_METHODS", "GET,POST,OPTIONS")
cors_allow_headers = env_list("ALLOW_HEADERS", "Content-Type,Authorization")
cors_expose_headers = env_list("EXPOSE_HEADERS", "")
cors_allow_origin_regex = os.getenv("ALLOW_ORIGIN_REGEX", "").strip() or None
cors_max_age = int(os.getenv("CORS_MAX_AGE", "600"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_allow_origins,
    allow_credentials=False,
    allow_methods=cors_allow_methods,
    allow_headers=cors_allow_headers,
    expose_headers=cors_expose_headers,
    allow_origin_regex=cors_allow_origin_regex,
    max_age=cors_max_age,
)


@app.options("/health")
@app.options("/memory/add")
@app.options("/memory/search")
@app.options("/memory/all")
async def cors_preflight() -> Response:
    return Response(status_code=204)


ssl_config = build_ssl_config()


@app.get("/health")
async def health() -> Dict[str, Any]:
    if memory_service is None:
        raise HTTPException(status_code=503, detail="memory service not initialized")
    return {
        "ok": True,
        "service": "robot-memory-backend",
        "embedder_provider": memory_service.config["embedder"]["provider"],
        "vector_store_provider": memory_service.config["vector_store"]["provider"],
        "default_infer": memory_service.default_infer,
        "port": int(os.getenv("PORT", os.getenv("MEMORY_BACKEND_PORT", "8766"))),
        "scheme": "https" if ssl_config["enabled"] else "http",
        "cors": {
            "allow_origins": cors_allow_origins,
            "allow_methods": cors_allow_methods,
            "allow_headers": cors_allow_headers,
        },
    }


@app.post("/memory/add")
async def add_memory(payload: MemoryAddRequest) -> Dict[str, Any]:
    if memory_service is None:
        raise HTTPException(status_code=503, detail="memory service not initialized")
    try:
        return await memory_service.add_turn(payload)
    except Exception as exc:
        logger.exception("Failed to add memory")
        raise HTTPException(status_code=500, detail=f"Failed to add memory: {exc}") from exc


@app.post("/memory/search")
async def search_memory(payload: MemorySearchRequest) -> Dict[str, Any]:
    if memory_service is None:
        raise HTTPException(status_code=503, detail="memory service not initialized")
    try:
        return await memory_service.search_memories(payload)
    except Exception as exc:
        logger.exception("Failed to search memory")
        raise HTTPException(status_code=500, detail=f"Failed to search memory: {exc}") from exc


@app.get("/memory/all")
async def get_all_memory(
    user_id: str = Query(..., min_length=1),
    top_k: int = Query(50, ge=1, le=200),
) -> Dict[str, Any]:
    if memory_service is None:
        raise HTTPException(status_code=503, detail="memory service not initialized")
    try:
        return await memory_service.get_all_memories(user_id=user_id, top_k=top_k)
    except Exception as exc:
        logger.exception("Failed to get all memories")
        raise HTTPException(status_code=500, detail=f"Failed to get all memories: {exc}") from exc


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", os.getenv("MEMORY_BACKEND_PORT", "8766")))

    logger.info(
        "Starting robot-memory-backend | scheme=%s | host=%s | port=%s",
        "https" if ssl_config["enabled"] else "http",
        host,
        port,
    )

    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=False,
        ssl_certfile=ssl_config["certfile"],
        ssl_keyfile=ssl_config["keyfile"],
    )
