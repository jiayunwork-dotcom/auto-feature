from fastapi import APIRouter

from app.api.upload import router as upload_router
from app.api.feature_engineering import router as feature_engineering_router
from app.api.feature_selection import router as feature_selection_router
from app.api.model_search import router as model_search_router
from app.api.ensemble import router as ensemble_router
from app.api.explainability import router as explainability_router
from app.api.pipeline import router as pipeline_router

router = APIRouter()

router.include_router(upload_router, tags=["upload"])
router.include_router(feature_engineering_router, tags=["feature-engineering"])
router.include_router(feature_selection_router, tags=["feature-selection"])
router.include_router(model_search_router, tags=["model-search"])
router.include_router(ensemble_router, tags=["ensemble"])
router.include_router(explainability_router, tags=["explainability"])
router.include_router(pipeline_router, tags=["pipeline"])
