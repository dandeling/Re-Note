import { Button } from "@/components/ui/button";
import { messages } from "@/lib/messages";

/** 결과보고서 PDF 파일 주소 (공개 연구의 보고서는 비로그인도 받을 수 있다). */
export function reportFileUrl(researchId: string) {
  return `/api/research/${encodeURIComponent(researchId)}/report`;
}

/** 결과보고서 PDF 인라인 뷰어 + 다운로드 (SPEC 7.2 연구 상세) */
export function ReportViewer({
  researchId,
  report,
}: {
  researchId: string;
  report: { assetId: string; filename: string } | null;
}) {
  const t = messages.research;
  if (!report) return <p className="text-muted-foreground">{t.noReport}</p>;
  const src = reportFileUrl(researchId);
  return (
    <div className="flex flex-col gap-3">
      <iframe src={src} title={t.reportViewerTitle} className="h-[70vh] w-full rounded-lg border" />
      <div>
        <Button asChild variant="outline" size="sm">
          <a href={`${src}?download=1`} download={report.filename}>
            {t.download}
          </a>
        </Button>
      </div>
    </div>
  );
}
