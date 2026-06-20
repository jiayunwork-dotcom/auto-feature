from fastapi import APIRouter

from app.api.upload import router as upload_router
from app.api.feature_engineering import router as feature_engineering_router
from app.api.feature_selection import router as feature_selection_router
from app.api.model_search import router as model_search_router
from app.api.ensemble import router as ensemble_router
from app.api.explainability import router as explainability_router
from app.api.pipeline import router as pipeline_router
from app.api.quality_report import router as quality_report_router
from app.api.data_versioning import router as data_versioning_router
from app.api.feature_attribution import router as feature_attribution_router

router = APIRouter()

router.include_router(upload_router, tags=["upload"])
router.include_router(feature_engineering_router, tags=["feature-engineering"])
router.include_router(feature_selection_router, tags=["feature-selection"])
router.include_router(model_search_router, tags=["model-search"])
router.include_router(ensemble_router, tags=["ensemble"])
router.include_router(explainability_router, tags=["explainability"])
router.include_router(pipeline_router, tags=["pipeline"])
router.include_router(quality_report_router, tags=["quality-report"])
router.include_router(data_versioning_router, tags=["data-versioning"])
router.include_router(feature_attribution_router, tags=["feature-attribution"])
