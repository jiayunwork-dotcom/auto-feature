CREATE TABLE auto_compare_strategies (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE UNIQUE,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    trigger_mode VARCHAR(32) NOT NULL DEFAULT 'on_upload',
    baseline_mode VARCHAR(32) NOT NULL DEFAULT 'first_version',
    custom_p_value_threshold FLOAT,
    custom_psi_threshold FLOAT,
    custom_drift_ratio_threshold FLOAT,
    poll_interval_minutes INTEGER DEFAULT 60,
    last_triggered_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE drift_report_exports (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    comparison_id INTEGER REFERENCES drift_comparisons(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    file_path TEXT,
    file_name VARCHAR(256),
    file_size INTEGER,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX idx_auto_compare_strategies_task_id ON auto_compare_strategies(task_id);
CREATE INDEX idx_auto_compare_strategies_enabled ON auto_compare_strategies(is_enabled) WHERE is_enabled = TRUE;
CREATE INDEX idx_drift_report_exports_task_id ON drift_report_exports(task_id);
CREATE INDEX idx_drift_report_exports_comparison_id ON drift_report_exports(comparison_id);
CREATE INDEX idx_drift_report_exports_status ON drift_report_exports(status);
