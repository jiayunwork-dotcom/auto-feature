import { useEffect, useRef } from "react";
import * as echarts from "echarts";

interface EChartsWrapperProps {
  option: echarts.EChartsOption;
  style?: React.CSSProperties;
  className?: string;
  theme?: string;
}

export default function EChartsWrapper({
  option,
  style,
  className,
  theme,
}: EChartsWrapperProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    const instance = echarts.init(chartRef.current, theme, {
      renderer: "canvas",
    });
    instanceRef.current = instance;
    instance.setOption(option);

    const handleResize = () => instance.resize();
    window.addEventListener("resize", handleResize);

    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(chartRef.current);

    return () => {
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
      instance.dispose();
      instanceRef.current = null;
    };
  }, [theme]);

  useEffect(() => {
    instanceRef.current?.setOption(option, { notMerge: false });
  }, [option]);

  return (
    <div
      ref={chartRef}
      className={className}
      style={{ width: "100%", height: "100%", ...style }}
    />
  );
}
