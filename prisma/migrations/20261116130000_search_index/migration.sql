-- 검색 색인 (SPEC 7.2, P6-2/P6-5)
-- 한글은 음절 단위라 trigram이 오타·띄어쓰기에 약하다. 음절을 자모로 분해해 두벌식 자판의
-- ASCII 글자로 바꾼 뒤(예: "음향" → "dmagid") trigram을 만든다. docs/decisions.md search-1
--   titleNorm: 제목 + 키워드(태그) + 분야. 단어 사이 공백 유지. word_similarity로 오타까지 허용해 비교한다.
--   bodyNorm : 요약 + 한계 / 고충 본문 + 해결 방법. 공백을 모두 없앤 형태. 부분 문자열(LIKE)로 비교한다
--              (띄어쓰기·조사 차이는 흡수하지만 오타는 허용하지 않는다 — 1만 건 1초 목표 때문. search-2).

CREATE TABLE "SearchDocument" (
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "titleNorm" TEXT NOT NULL DEFAULT '',
    "bodyNorm" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "SearchDocument_pkey" PRIMARY KEY ("kind","refId")
);

CREATE INDEX "SearchDocument_titleNorm_trgm_idx" ON "SearchDocument" USING GIN ("titleNorm" gin_trgm_ops);
CREATE INDEX "SearchDocument_bodyNorm_trgm_idx" ON "SearchDocument" USING GIN ("bodyNorm" gin_trgm_ops);

-- 소문자화 → 한글 음절을 자모(ASCII)로 분해 → 글자·숫자가 아닌 것은 공백 → 공백 정리
CREATE OR REPLACE FUNCTION rm_search_normalize(input text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
  cho  CONSTANT text[] := ARRAY['r','rr','s','e','ee','f','a','q','qq','t','tt','d','w','ww','c','z','x','v','g'];
  jung CONSTANT text[] := ARRAY['k','o','i','oo','j','p','u','pp','h','hk','ho','hl','y','n','nj','np','nl','b','m','ml','l'];
  jong CONSTANT text[] := ARRAY['','r','rr','rt','s','sw','sg','e','f','fr','fa','fq','ft','fx','fv','fg','a','q','qt','t','tt','d','w','c','z','x','v','g'];
  ch text;
  code int;
  result text := '';
BEGIN
  FOREACH ch IN ARRAY regexp_split_to_array(lower(left(input, 20000)), '') LOOP
    code := ascii(ch);
    IF code BETWEEN 44032 AND 55203 THEN
      code := code - 44032;
      result := result || cho[code / 588 + 1] || jung[(code % 588) / 28 + 1] || jong[code % 28 + 1];
    ELSIF (code BETWEEN 97 AND 122) OR (code BETWEEN 48 AND 57) THEN
      result := result || ch;
    ELSIF code > 127 AND ch ~ '[[:alnum:]]' THEN
      result := result || ch;
    ELSE
      result := result || ' ';
    END IF;
  END LOOP;
  RETURN btrim(regexp_replace(result, ' +', ' ', 'g'));
END;
$$;

CREATE OR REPLACE FUNCTION rm_search_index_research() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "SearchDocument" WHERE "kind" = 'research' AND "refId" = OLD."id";
    RETURN OLD;
  END IF;
  INSERT INTO "SearchDocument" ("kind", "refId", "titleNorm", "bodyNorm")
  VALUES (
    'research', NEW."id",
    rm_search_normalize(NEW."title" || ' ' || array_to_string(coalesce(NEW."keywords", ARRAY[]::text[]), ' ') || ' ' || NEW."field"),
    replace(rm_search_normalize(NEW."summary" || ' ' || NEW."limitations"), ' ', '')
  )
  ON CONFLICT ("kind", "refId") DO UPDATE SET "titleNorm" = EXCLUDED."titleNorm", "bodyNorm" = EXCLUDED."bodyNorm";
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION rm_search_index_pain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "SearchDocument" WHERE "kind" = 'pain' AND "refId" = OLD."id";
    RETURN OLD;
  END IF;
  INSERT INTO "SearchDocument" ("kind", "refId", "titleNorm", "bodyNorm")
  VALUES (
    'pain', NEW."id",
    rm_search_normalize(NEW."title" || ' ' || array_to_string(coalesce(NEW."tags", ARRAY[]::text[]), ' ') || ' ' || NEW."field"),
    replace(rm_search_normalize(NEW."body" || ' ' || coalesce(NEW."resolution", '')), ' ', '')
  )
  ON CONFLICT ("kind", "refId") DO UPDATE SET "titleNorm" = EXCLUDED."titleNorm", "bodyNorm" = EXCLUDED."bodyNorm";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Research_search_index"
  AFTER INSERT OR DELETE OR UPDATE OF "title", "summary", "field", "keywords", "limitations" ON "Research"
  FOR EACH ROW EXECUTE FUNCTION rm_search_index_research();

CREATE TRIGGER "PainPost_search_index"
  AFTER INSERT OR DELETE OR UPDATE OF "title", "body", "field", "tags", "resolution" ON "PainPost"
  FOR EACH ROW EXECUTE FUNCTION rm_search_index_pain();

-- 이미 있는 행 색인
INSERT INTO "SearchDocument" ("kind", "refId", "titleNorm", "bodyNorm")
SELECT 'research', "id",
  rm_search_normalize("title" || ' ' || array_to_string(coalesce("keywords", ARRAY[]::text[]), ' ') || ' ' || "field"),
  replace(rm_search_normalize("summary" || ' ' || "limitations"), ' ', '')
FROM "Research";

INSERT INTO "SearchDocument" ("kind", "refId", "titleNorm", "bodyNorm")
SELECT 'pain', "id",
  rm_search_normalize("title" || ' ' || array_to_string(coalesce("tags", ARRAY[]::text[]), ' ') || ' ' || "field"),
  replace(rm_search_normalize("body" || ' ' || coalesce("resolution", '')), ' ', '')
FROM "PainPost";
