from __future__ import annotations

import datetime
import os

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.models.models import DatasetVersion, DriftComparison, Task

SYNC_DB_URL = settings.DATABASE_URL.replace("+asyncpg", "+psycopg2")
sync_engine = create_engine(SYNC_DB_URL, echo=False, pool_size=5, max_overflow=10)
SyncSessionLocal = sessionmaker(bind=sync_engine, class_=Session, expire_on_commit=False)

COLOR_BLUE = "#3b82f6"
COLOR_ORANGE = "#f59e0b"


class DriftPDFReportService:

    @staticmethod
    def generate_chart_png(column_result: dict, output_path: str) -> str:
        viz_data = column_result.get("visualization_data", {})
        col_type = viz_data.get("type")

        fig, ax = plt.subplots(figsize=(6, 3.5), dpi=120)
        ax.set_facecolor("#1e1e2e")
        fig.patch.set_facecolor("#1e1e2e")

        if col_type == "density":
            x = np.array(viz_data.get("x", []))
            density_a = np.array(viz_data.get("density_a", []))
            density_b = np.array(viz_data.get("density_b", []))

            if len(x) > 0:
                ax.plot(x, density_a, color=COLOR_BLUE, linewidth=2, label="Version A")
                ax.fill_between(x, density_a, alpha=0.25, color=COLOR_BLUE)
                ax.plot(x, density_b, color=COLOR_ORANGE, linewidth=2, label="Version B")
                ax.fill_between(x, density_b, alpha=0.25, color=COLOR_ORANGE)

            ax.set_xlabel("Value", color="#cdd6f4", fontsize=10)
            ax.set_ylabel("Density", color="#cdd6f4", fontsize=10)
            ax.legend(loc="upper right", fontsize=9, facecolor="#313244", edgecolor="#45475a", labelcolor="#cdd6f4")

        elif col_type == "bar":
            categories = viz_data.get("categories", [])
            counts_a = viz_data.get("counts_a", [])
            counts_b = viz_data.get("counts_b", [])

            if len(categories) > 0:
                x = np.arange(len(categories))
                width = 0.35

                ax.bar(x - width / 2, counts_a, width, color=COLOR_BLUE, alpha=0.85, label="Version A")
                ax.bar(x + width / 2, counts_b, width, color=COLOR_ORANGE, alpha=0.85, label="Version B")

                display_cats = [str(c)[:15] for c in categories]
                ax.set_xticks(x)
                ax.set_xticklabels(display_cats, rotation=45, ha="right", color="#cdd6f4", fontsize=8)
                ax.set_ylabel("Count", color="#cdd6f4", fontsize=10)
                ax.legend(loc="upper right", fontsize=9, facecolor="#313244", edgecolor="#45475a", labelcolor="#cdd6f4")

        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["left"].set_color("#45475a")
        ax.spines["bottom"].set_color("#45475a")
        ax.tick_params(axis="y", colors="#cdd6f4", labelsize=8)
        ax.grid(True, axis="y", alpha=0.2, color="#45475a", linestyle="--")

        column_name = column_result.get("column_name", "")
        ax.set_title(column_name, color="#cdd6f4", fontsize=11, fontweight="bold", pad=10)

        plt.tight_layout()
        fig.savefig(output_path, format="png", facecolor=fig.get_facecolor(), bbox_inches="tight")
        plt.close(fig)

        return output_path

    @staticmethod
    def generate_report(comparison_id: int, output_dir: str | None = None) -> dict:
        if output_dir is None:
            output_dir = os.path.join(settings.UPLOAD_DIR, "reports")
        os.makedirs(output_dir, exist_ok=True)

        with SyncSessionLocal() as db:
            comparison = db.query(DriftComparison).filter(DriftComparison.id == comparison_id).first()
            if not comparison:
                raise ValueError(f"DriftComparison with id {comparison_id} not found")

            task = db.query(Task).filter(Task.id == comparison.task_id).first()
            version_a = None
            version_b = None

            if comparison.version_a_id:
                version_a = db.query(DatasetVersion).filter(DatasetVersion.id == comparison.version_a_id).first()
            if comparison.version_b_id:
                version_b = db.query(DatasetVersion).filter(DatasetVersion.id == comparison.version_b_id).first()

            column_results = (comparison.column_results or {}).get("columns", []) if comparison.column_results else []
            added_columns = comparison.added_columns or []
            removed_columns = comparison.removed_columns or []

        task_name = task.filename if task else f"Task-{comparison.task_id}"
        version_a_num = version_a.version_number if version_a else "N/A"
        version_b_num = version_b.version_number if version_b else "N/A"
        generated_at = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        pdf_filename = f"drift_report_{comparison_id}_{timestamp}.pdf"
        pdf_path = os.path.abspath(os.path.join(output_dir, pdf_filename))

        chart_dir = os.path.join(output_dir, f"charts_{comparison_id}_{timestamp}")
        os.makedirs(chart_dir, exist_ok=True)

        doc = SimpleDocTemplate(
            pdf_path,
            pagesize=A4,
            rightMargin=20 * mm,
            leftMargin=20 * mm,
            topMargin=20 * mm,
            bottomMargin=20 * mm,
        )

        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            "CustomTitle",
            parent=styles["Title"],
            fontSize=20,
            textColor=colors.HexColor("#1e3a8a"),
            alignment=TA_CENTER,
            spaceAfter=6,
        )
        subtitle_style = ParagraphStyle(
            "CustomSubtitle",
            parent=styles["Normal"],
            fontSize=11,
            textColor=colors.HexColor("#475569"),
            alignment=TA_CENTER,
            spaceAfter=4,
        )
        section_style = ParagraphStyle(
            "CustomSection",
            parent=styles["Heading2"],
            fontSize=14,
            textColor=colors.HexColor("#1e40af"),
            spaceBefore=14,
            spaceAfter=8,
        )
        normal_style = ParagraphStyle(
            "CustomNormal",
            parent=styles["Normal"],
            fontSize=10,
            textColor=colors.HexColor("#1e293b"),
            alignment=TA_LEFT,
            spaceAfter=4,
        )
        cell_style = ParagraphStyle(
            "CellStyle",
            parent=styles["Normal"],
            fontSize=9,
            textColor=colors.HexColor("#1e293b"),
            alignment=TA_LEFT,
        )

        story = []

        story.append(Paragraph("Data Drift Comparison Report", title_style))
        story.append(Paragraph(f"Task: {task_name}", subtitle_style))
        story.append(Paragraph(
            f"Version A: v{version_a_num} &nbsp;&nbsp;|&nbsp;&nbsp; Version B: v{version_b_num}",
            subtitle_style,
        ))
        story.append(Paragraph(f"Generated at: {generated_at}", subtitle_style))
        story.append(Spacer(1, 8 * mm))

        story.append(Paragraph("Summary Statistics", section_style))

        total_cols = len(column_results)
        stable_count = sum(1 for r in column_results if r.get("verdict") == "稳定")
        mild_count = sum(1 for r in column_results if r.get("verdict") == "轻微漂移")
        significant_count = sum(1 for r in column_results if r.get("verdict") == "显著漂移")
        drift_ratio = comparison.significant_drift_ratio or (
            significant_count / total_cols if total_cols > 0 else 0.0
        )
        warning_status = "Yes" if comparison.overall_warning else "No"

        summary_data = [
            ["Metric", "Value"],
            ["Total Columns", str(total_cols)],
            ["Stable", str(stable_count)],
            ["Mild Drift", str(mild_count)],
            ["Significant Drift", str(significant_count)],
            ["Drift Ratio", f"{drift_ratio:.2%}"],
            ["Warning Triggered", warning_status],
        ]

        summary_table = Table(summary_data, colWidths=[55 * mm, 40 * mm])
        summary_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e40af")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("ALIGN", (0, 0), (-1, -1), "LEFT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ]))
        story.append(summary_table)
        story.append(Spacer(1, 6 * mm))

        if added_columns:
            story.append(Paragraph(f"Added Columns: {', '.join(added_columns)}", normal_style))
        if removed_columns:
            story.append(Paragraph(f"Removed Columns: {', '.join(removed_columns)}", normal_style))

        story.append(Paragraph("Column Comparison Details", section_style))

        detail_header = [
            Paragraph("<b>Column</b>", cell_style),
            Paragraph("<b>Type</b>", cell_style),
            Paragraph("<b>Method</b>", cell_style),
            Paragraph("<b>Statistic</b>", cell_style),
            Paragraph("<b>P-value / PSI</b>", cell_style),
            Paragraph("<b>Verdict</b>", cell_style),
        ]
        detail_data = [detail_header]

        for result in column_results:
            col_name = Paragraph(result.get("column_name", ""), cell_style)
            col_type = Paragraph(result.get("column_type", ""), cell_style)
            method = Paragraph(result.get("method", ""), cell_style)
            stat_val = result.get("statistic")
            statistic = Paragraph(f"{stat_val:.4f}" if stat_val is not None else "-", cell_style)
            p_val = result.get("p_value_or_psi")
            p_or_psi = Paragraph(f"{p_val:.4f}" if p_val is not None else "-", cell_style)

            verdict = result.get("verdict", "")
            if verdict == "显著漂移":
                verdict_para = Paragraph(f'<font color="#dc2626"><b>{verdict}</b></font>', cell_style)
            elif verdict == "轻微漂移":
                verdict_para = Paragraph(f'<font color="#d97706"><b>{verdict}</b></font>', cell_style)
            else:
                verdict_para = Paragraph(f'<font color="#059669"><b>{verdict}</b></font>', cell_style)

            detail_data.append([col_name, col_type, method, statistic, p_or_psi, verdict_para])

        detail_table = Table(detail_data, colWidths=[35 * mm, 18 * mm, 20 * mm, 22 * mm, 28 * mm, 22 * mm], repeatRows=1)
        detail_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ALIGN", (0, 0), (-1, -1), "LEFT"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(detail_table)

        if column_results:
            story.append(PageBreak())
            story.append(Paragraph("Distribution Charts", section_style))
            story.append(Spacer(1, 3 * mm))

            for idx, result in enumerate(column_results):
                chart_filename = f"chart_{idx}_{result.get('column_name', 'col')}.png"
                chart_path = os.path.join(chart_dir, chart_filename)
                DriftPDFReportService.generate_chart_png(result, chart_path)

                col_name = result.get("column_name", "")
                story.append(Paragraph(f"<b>{col_name}</b>", normal_style))

                img = Image(chart_path, width=140 * mm, height=82 * mm)
                story.append(img)
                story.append(Spacer(1, 4 * mm))

        doc.build(story)

        file_size = os.path.getsize(pdf_path)

        return {
            "file_path": pdf_path,
            "file_name": pdf_filename,
            "file_size": file_size,
        }
