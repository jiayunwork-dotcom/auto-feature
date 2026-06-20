CREATE TABLE feature_attributions (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    shap_values JSONB,
    interaction_matrix JSONB,
    feature_dag JSONB,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE INDEX idx_feature_attributions_task_id ON feature_attributions(task_id);
CREATE INDEX idx_feature_attributions_status ON feature_attributions(status);
