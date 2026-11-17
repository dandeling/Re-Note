-- 변환·가져오기 작업 (P3-2 ~ P3-5): DOCX·Markdown 가져오기 유형, 작업 입력값/결과 JSON
ALTER TYPE "ConversionType" ADD VALUE 'IMPORT_DOCX';
ALTER TYPE "ConversionType" ADD VALUE 'IMPORT_MD';

ALTER TABLE "ConversionJob" ADD COLUMN     "params" JSONB,
ADD COLUMN     "result" JSONB;
