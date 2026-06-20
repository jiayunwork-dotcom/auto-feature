CREATE TABLE dataset_versions (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    filename VARCHAR(256) NOT NULL,
    file_path TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    column_count INTEGER NOT NULL,
    file_hash_md5 VARCHAR(32) NOT NULL,
    columns_info JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE drift_comparisons (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    version_a_id INTEGER REFERENCES dataset_versions(id),
    version_b_id INTEGER REFERENCES dataset_versions(id),
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    column_results JSONB,
    added_columns JSONB,
    removed_columns JSONB,
    overall_warning BOOLEAN NOT NULL DEFAULT FALSE,
    significant_drift_ratio FLOAT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP,
    error_message TEXT
);

CREATE TABLE drift_warnings (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    comparison_id INTEGER REFERENCES drift_comparisons(id),
    warning_message TEXT,
    significant_columns JSONB,
    drift_ratio FLOAT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMP
);

CREATE INDEX idx_dataset_versions_task_id ON dataset_versions(task_id);
CREATE INDEX idx_dataset_versions_task_version ON dataset_versions(task_id, version_number);
CREATE INDEX idx_dataset_versions_file_hash ON dataset_versions(task_id, file_hash_md5);
CREATE INDEX idx_drift_comparisons_task_id ON drift_comparisons(task_id);
CREATE INDEX idx_drift_comparisons_status ON drift_comparisons(status);
CREATE INDEX idx_drift_warnings_task_id ON drift_warnings(task_id);
CREATE INDEX idx_drift_warnings_active ON drift_warnings(task_id, is_active);
