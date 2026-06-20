import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Layout from "@/components/Layout";
import UploadPage from "@/pages/UploadPage";
import OverviewPage from "@/pages/OverviewPage";
import DataVersioningPage from "@/pages/DataVersioningPage";
import DriftComparisonPage from "@/pages/DriftComparisonPage";
import FeatureEngineeringPage from "@/pages/FeatureEngineeringPage";
import FeatureSelectionPage from "@/pages/FeatureSelectionPage";
import ModelSearchPage from "@/pages/ModelSearchPage";
import EnsemblePage from "@/pages/EnsemblePage";
import ExplainabilityPage from "@/pages/ExplainabilityPage";
import PipelinePage from "@/pages/PipelinePage";
import QualityReportPage from "@/pages/QualityReportPage";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<UploadPage />} />
          <Route path="/overview/:taskId" element={<OverviewPage />} />
          <Route path="/versioning/:taskId" element={<DataVersioningPage />} />
          <Route path="/drift-comparison/:taskId/:comparisonId" element={<DriftComparisonPage />} />
          <Route path="/quality-report/:taskId" element={<QualityReportPage />} />
          <Route path="/feature-engineering/:taskId" element={<FeatureEngineeringPage />} />
          <Route path="/feature-selection/:taskId" element={<FeatureSelectionPage />} />
          <Route path="/model-search/:taskId" element={<ModelSearchPage />} />
          <Route path="/ensemble/:taskId" element={<EnsemblePage />} />
          <Route path="/explainability/:taskId" element={<ExplainabilityPage />} />
          <Route path="/pipeline/:taskId" element={<PipelinePage />} />
        </Route>
      </Routes>
    </Router>
  );
}
