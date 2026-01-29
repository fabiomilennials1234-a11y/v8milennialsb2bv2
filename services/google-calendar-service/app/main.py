"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.auth import router as auth_router
from app.api.calendar import router as calendar_router
from app.api.internal import router as internal_router
from app.config import get_settings
from app.core.exceptions import CalendarServiceError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    # Startup
    settings = get_settings()
    logger.info(f"Starting {settings.app_name} in {settings.app_env} mode")
    logger.info(f"Frontend URL: {settings.frontend_url}")

    yield

    # Shutdown
    logger.info("Shutting down Google Calendar Service")


def create_app() -> FastAPI:
    """Create and configure FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        description="Google Calendar OAuth 2.0 integration microservice",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url="/redoc" if not settings.is_production else None,
    )

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            settings.frontend_url,
            "http://localhost:8080",
            "http://localhost:8081",
            "http://localhost:5173",
            "http://localhost:3000",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Exception handlers
    @app.exception_handler(CalendarServiceError)
    async def calendar_service_error_handler(
        request: Request, exc: CalendarServiceError
    ):
        """Handle CalendarServiceError exceptions."""
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": exc.message,
                "details": exc.details,
            },
        )

    # Health check
    @app.get("/health")
    async def health_check():
        """Health check endpoint."""
        return {"status": "healthy", "service": "google-calendar-service"}

    # Include routers
    app.include_router(auth_router, prefix="/api")
    app.include_router(calendar_router, prefix="/api")
    app.include_router(internal_router, prefix="/api")

    return app


# Create app instance
app = create_app()


if __name__ == "__main__":
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=not settings.is_production,
    )
