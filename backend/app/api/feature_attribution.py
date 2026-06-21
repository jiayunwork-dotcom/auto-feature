import os

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.models import FeatureAttribution, Task, Pipeline as PipelineModel
from app.tasks.celery_app import celery_app

router = APIRouter()


@router.post("/tasks/{task_id}/feature-attribution")
async def start_feature_attribution(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status not in (
        "feature_selection_done",
        "explainability_done",
        "model_search_done",
        "ensemble_done",
        "completed",
    ):
        raise HTTPException(
            status_code=400,
            detail="Feature selection must be completed before running attribution analysis",
        )

    selected_path = os.path.join(
        settings.UPLOAD_DIR, f"selected_{task_id}.parquet"
    )
    if not os.path.exists(selected_path):
        raise HTTPException(
            status_code=400,
            detail="selected_features is empty. Please complete feature selection first.",
        )

    best_models_path = os.path.join(
        settings.PIPELINE_DIR, f"best_models_{task_id}.joblib"
    )
    if not os.path.exists(best_models_path):
        raise HTTPException(
            status_code=400,
            detail="Trained model not found. Please complete model search first.",
        )

    celery_app.send_task("app.tasks.feature_attribution.run", args=[task_id])

    return {
        "task_id": task_id,
        "status": "started",
        "message": "Feature attribution task started",
    }


@router.get("/tasks/{task_id}/feature-attribution/latest")
async def get_latest_attribution(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    result = await db.execute(
        select(FeatureAttribution)
        .where(FeatureAttribution.task_id == task_id)
        .order_by(FeatureAttribution.id.desc())
    )
    attribution = result.scalars().first()

    if not attribution:
        raise HTTPException(status_code=404, detail="Feature attribution result not found")

    return {
        "id": attribution.id,
        "task_id": attribution.task_id,
        "status": attribution.status,
        "shap_values": attribution.shap_values,
        "interaction_matrix": attribution.interaction_matrix,
        "feature_dag": attribution.feature_dag,
        "error_message": attribution.error_message,
        "created_at": attribution.created_at.isoformat() if attribution.created_at else None,
        "completed_at": attribution.completed_at.isoformat() if attribution.completed_at else None,
    }


@router.get("/tasks/{task_id}/feature-attribution/{attribution_id}")
async def get_attribution(
    task_id: int,
    attribution_id: int,
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    attribution = await db.get(FeatureAttribution, attribution_id)
    if not attribution or attribution.task_id != task_id:
        raise HTTPException(status_code=404, detail="Feature attribution not found")

    return {
        "id": attribution.id,
        "task_id": attribution.task_id,
        "status": attribution.status,
        "shap_values": attribution.shap_values,
        "interaction_matrix": attribution.interaction_matrix,
        "feature_dag": attribution.feature_dag,
        "error_message": attribution.error_message,
        "created_at": attribution.created_at.isoformat() if attribution.created_at else None,
        "completed_at": attribution.completed_at.isoformat() if attribution.completed_at else None,
    }


@router.websocket("/ws/tasks/{task_id}/feature-attribution")
async def ws_feature_attribution(task_id: int, websocket: WebSocket):
    await websocket.accept()
    import json
    import redis.asyncio as aioredis

    try:
        r = aioredis.from_url(settings.REDIS_URL)
        channel = f"feature_attribution:{task_id}"
        pubsub = r.pubsub()
        await pubsub.subscribe(channel)

        try:
            async for message in pubsub.listen():
                if message["type"] == "message":
                    data = json.loads(message["data"])
                    await websocket.send_json(data)
        finally:
            await pubsub.unsubscribe(channel)
            await r.close()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass


@router.get("/tasks/{task_id}/feature-attribution")
async def list_feature_attributions(
    task_id: int,
    status: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    stmt = select(FeatureAttribution).where(FeatureAttribution.task_id == task_id)
    if status:
        stmt = stmt.where(FeatureAttribution.status == status)
    stmt = stmt.order_by(FeatureAttribution.created_at.desc())

    result = await db.execute(stmt)
    attributions = result.scalars().all()

    return {
        "attributions": [
            {
                "id": a.id,
                "task_id": a.task_id,
                "status": a.status,
                "created_at": a.created_at.isoformat() if a.created_at else None,
                "completed_at": a.completed_at.isoformat() if a.completed_at else None,
                "error_message": a.error_message,
                "feature_count": len(a.shap_values.get("global_importance", []))
                if a.shap_values
                else 0,
            }
            for a in attributions
        ]
    }


@router.post("/tasks/{task_id}/feature-attribution/compare")
async def compare_feature_attributions(
    task_id: int,
    attribution_id_a: int = Query(...),
    attribution_id_b: int = Query(...),
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    attr_a = await db.get(FeatureAttribution, attribution_id_a)
    attr_b = await db.get(FeatureAttribution, attribution_id_b)

    if not attr_a or attr_a.task_id != task_id:
        raise HTTPException(status_code=400, detail="Attribution A not found for this task")
    if not attr_b or attr_b.task_id != task_id:
        raise HTTPException(status_code=400, detail="Attribution B not found for this task")

    if attr_a.status != "completed":
        raise HTTPException(status_code=400, detail="Attribution A is not completed")
    if attr_b.status != "completed":
        raise HTTPException(status_code=400, detail="Attribution B is not completed")

    gi_a = attr_a.shap_values.get("global_importance", []) if attr_a.shap_values else []
    gi_b = attr_b.shap_values.get("global_importance", []) if attr_b.shap_values else []

    features_a = {item["feature"] for item in gi_a}
    features_b = {item["feature"] for item in gi_b}
    intersection = features_a & features_b

    if not intersection:
        return {
            "no_intersection": True,
            "message": "特征子集无交集，无法对比",
            "attribution_a": {
                "id": attr_a.id,
                "created_at": attr_a.created_at.isoformat() if attr_a.created_at else None,
                "feature_count": len(features_a),
            },
            "attribution_b": {
                "id": attr_b.id,
                "created_at": attr_b.created_at.isoformat() if attr_b.created_at else None,
                "feature_count": len(features_b),
            },
        }

    rank_a = {item["feature"]: i + 1 for i, item in enumerate(gi_a)}
    rank_b = {item["feature"]: i + 1 for i, item in enumerate(gi_b)}
    value_a = {item["feature"]: item["shap_value"] for item in gi_a}
    value_b = {item["feature"]: item["shap_value"] for item in gi_b}

    all_features = list(features_a | features_b)
    importance_changes = []
    for feat in all_features:
        r_a = rank_a.get(feat)
        r_b = rank_b.get(feat)
        v_a = value_a.get(feat, 0)
        v_b = value_b.get(feat, 0)
        status = "unchanged"
        if r_a is None and r_b is not None:
            status = "new"
        elif r_a is not None and r_b is None:
            status = "removed"
        elif r_a is not None and r_b is not None:
            if r_b < r_a:
                status = "up"
            elif r_b > r_a:
                status = "down"
        rank_delta = (r_a - r_b) if (r_a is not None and r_b is not None) else None
        is_highlight = rank_delta is not None and abs(rank_delta) > 3
        importance_changes.append({
            "feature": feat,
            "rank_a": r_a,
            "rank_b": r_b,
            "rank_delta": rank_delta,
            "value_a": round(v_a, 6),
            "value_b": round(v_b, 6),
            "value_change_pct": round(((v_b - v_a) / v_a * 100), 2) if v_a != 0 else None,
            "status": status,
            "highlight": is_highlight,
        })

    importance_changes.sort(
        key=lambda x: (
            x["rank_b"] if x["rank_b"] is not None else 10**9,
            x["rank_a"] if x["rank_a"] is not None else 10**9,
        )
    )

    pairs_a_raw = attr_a.interaction_matrix.get("top_5_pairs", []) if attr_a.interaction_matrix else []
    pairs_b_raw = attr_b.interaction_matrix.get("top_5_pairs", []) if attr_b.interaction_matrix else []

    def pair_key(p):
        a, b = sorted([p["feature_a"], p["feature_b"]])
        return f"{a}__{b}"

    pairs_a = {pair_key(p): p for p in pairs_a_raw}
    pairs_b = {pair_key(p): p for p in pairs_b_raw}
    all_pair_keys = list(set(pairs_a.keys()) | set(pairs_b.keys()))

    interaction_changes = []
    for pk in all_pair_keys:
        p_a = pairs_a.get(pk)
        p_b = pairs_b.get(pk)
        if p_a and p_b:
            s_a = p_a["strength"]
            s_b = p_b["strength"]
            change_pct = round(((s_b - s_a) / s_a * 100), 2) if s_a != 0 else None
            direction = "up" if s_b > s_a else ("down" if s_b < s_a else "same")
            interaction_changes.append({
                "feature_a": p_a["feature_a"],
                "feature_b": p_a["feature_b"],
                "strength_a": round(s_a, 6),
                "strength_b": round(s_b, 6),
                "change_pct": change_pct,
                "direction": direction,
                "status": "common",
            })
        elif p_a and not p_b:
            interaction_changes.append({
                "feature_a": p_a["feature_a"],
                "feature_b": p_a["feature_b"],
                "strength_a": round(p_a["strength"], 6),
                "strength_b": None,
                "change_pct": None,
                "direction": None,
                "status": "removed",
            })
        else:
            interaction_changes.append({
                "feature_a": p_b["feature_a"],
                "feature_b": p_b["feature_b"],
                "strength_a": None,
                "strength_b": round(p_b["strength"], 6),
                "change_pct": None,
                "direction": None,
                "status": "new",
            })

    dag_a = attr_a.feature_dag or {}
    dag_b = attr_b.feature_dag or {}
    tree_a = dag_a.get("tree", {}) or {}
    tree_b = dag_b.get("tree", {}) or {}

    def collect_edges(tree: dict) -> dict:
        edge_map = {}
        for root, node in tree.items():
            def walk(n, parent=None):
                name = n.get("name")
                if parent is not None:
                    key = f"{parent}->{name}"
                    edge_map[key] = {
                        "source": parent,
                        "target": name,
                        "operation": n.get("operation"),
                    }
                for child in n.get("children", []) or []:
                    walk(child, name)
            walk(node)
        return edge_map

    common_features = list(intersection)
    dag_diffs = []

    for feat in common_features:
        node_a = tree_a.get(feat)
        node_b = tree_b.get(feat)
        if not node_a or not node_b:
            if node_a or node_b:
                dag_diffs.append({
                    "feature": feat,
                    "has_diff": True,
                    "note": "Feature tree exists in only one attribution",
                    "tree_a": node_a,
                    "tree_b": node_b,
                    "added_edges": [],
                    "removed_edges": [],
                })
            continue

        feat_edge_map_a = {}
        feat_edge_map_b = {}

        def walk_and_collect(n, parent=None, collector=None):
            name = n.get("name")
            if parent is not None and collector is not None:
                key = f"{parent}->{name}"
                collector[key] = {
                    "source": parent,
                    "target": name,
                    "operation": n.get("operation"),
                }
            for child in n.get("children", []) or []:
                walk_and_collect(child, name, collector)

        walk_and_collect(node_a, None, feat_edge_map_a)
        walk_and_collect(node_b, None, feat_edge_map_b)

        keys_a = set(feat_edge_map_a.keys())
        keys_b = set(feat_edge_map_b.keys())

        added = [feat_edge_map_b[k] for k in (keys_b - keys_a)]
        removed = [feat_edge_map_a[k] for k in (keys_a - keys_b)]

        if added or removed:
            dag_diffs.append({
                "feature": feat,
                "has_diff": True,
                "tree_a": node_a,
                "tree_b": node_b,
                "added_edges": added,
                "removed_edges": removed,
            })

    return {
        "no_intersection": False,
        "attribution_a": {
            "id": attr_a.id,
            "created_at": attr_a.created_at.isoformat() if attr_a.created_at else None,
            "completed_at": attr_a.completed_at.isoformat() if attr_a.completed_at else None,
            "feature_count": len(features_a),
        },
        "attribution_b": {
            "id": attr_b.id,
            "created_at": attr_b.created_at.isoformat() if attr_b.created_at else None,
            "completed_at": attr_b.completed_at.isoformat() if attr_b.completed_at else None,
            "feature_count": len(features_b),
        },
        "importance_changes": importance_changes,
        "interaction_changes": interaction_changes,
        "dag_diffs": dag_diffs,
    }
