ALTER TABLE feature_engineering_logs
ADD COLUMN IF NOT EXISTS feature_lineage JSONB;

COMMENT ON COLUMN feature_engineering_logs.feature_lineage IS 'Mapping from generated feature name to its parents and operation: {feature_name: {parents: [...], operation: str}}';
