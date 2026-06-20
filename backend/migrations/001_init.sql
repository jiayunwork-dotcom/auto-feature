CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE tasks (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(256) NOT NULL,
    total_rows INTEGER,
    total_columns INTEGER,
    target_column VARCHAR(128),
    task_type VARCHAR(32),
    status VARCHAR(32) NOT NULL DEFAULT 'uploaded',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE column_inferences (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    column_name VARCHAR(128) NOT NULL,
    inferred_type VARCHAR(32) NOT NULL,
    confirmed_type VARCHAR(32),
    unique_count INTEGER,
    missing_ratio FLOAT,
    is_target BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE feature_engineering_logs (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    stage VARCHAR(64) NOT NULL,
    original_features INTEGER,
    transformed_features INTEGER,
    contribution_by_type JSONB,
    config JSONB
);

CREATE TABLE feature_selection_logs (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    stage VARCHAR(64) NOT NULL,
    remaining_count INTEGER,
    removed_features JSONB,
    importance_top30 JSONB
);

CREATE TABLE model_results (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    model_name VARCHAR(128) NOT NULL,
    best_params JSONB,
    best_score FLOAT,
    rank INTEGER
);

CREATE TABLE ensemble_results (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    stacking_score FLOAT,
    blending_score FLOAT,
    single_best_score FLOAT,
    meta_learner VARCHAR(128),
    base_models JSONB
);

CREATE TABLE shap_results (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    scope VARCHAR(32) NOT NULL,
    data JSONB
);

CREATE TABLE pipelines (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_column_inferences_task_id ON column_inferences(task_id);
CREATE INDEX idx_feature_engineering_logs_task_id ON feature_engineering_logs(task_id);
CREATE INDEX idx_feature_selection_logs_task_id ON feature_selection_logs(task_id);
CREATE INDEX idx_model_results_task_id ON model_results(task_id);
CREATE INDEX idx_ensemble_results_task_id ON ensemble_results(task_id);
CREATE INDEX idx_shap_results_task_id ON shap_results(task_id);
CREATE INDEX idx_pipelines_task_id ON pipelines(task_id);
CREATE INDEX idx_tasks_status ON tasks(status);
