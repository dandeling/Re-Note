import { log } from "@/lib/log";

/**
 * 임베딩 제공자 추상화 (SPEC 7.2-2).
 * 제공자는 아직 정해지지 않았다(SPEC 14장). 실제 외부 API 구현체는 없고,
 * 테스트·로컬 확인용 `fake` 구현만 등록되어 있다. docs/decisions.md search-3
 */
export interface EmbeddingProvider {
  /** 로그·디버깅용 이름 */
  readonly name: string;
  /** 벡터 차원. 저장된 벡터와 차원이 다르면 그 행은 벡터 점수에서 제외된다. */
  readonly dimensions: number;
  /** 입력 순서대로 벡터를 돌려준다. */
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * 테스트용 가짜 임베딩: 글자 2-gram을 해시해 고정 차원 벡터에 누적한 뒤 정규화한다.
 * 외부 호출이 없고 결정적이다. 의미 유사도가 아니라 표면 유사도만 반영하므로 운영용이 아니다.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = "fake";
  constructor(readonly dimensions = 64) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const v = new Array<number>(this.dimensions).fill(0);
      const chars = [...text.toLowerCase().replace(/\s+/g, "")];
      for (let i = 0; i < chars.length; i += 1) {
        const gram = chars[i] + (chars[i + 1] ?? "");
        let h = 2166136261;
        for (const c of gram) h = Math.imul(h ^ (c.codePointAt(0) ?? 0), 16777619);
        v[(h >>> 0) % this.dimensions] += 1;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      return norm === 0 ? v : v.map((x) => x / norm);
    });
  }
}

const PROVIDERS: Record<string, () => EmbeddingProvider> = {
  fake: () => new FakeEmbeddingProvider(),
};

let warned = false;

/**
 * `EMBEDDING_PROVIDER` 환경변수로 제공자를 고른다.
 * 비어 있거나 알 수 없는 값이면 null → trigram 검색만 사용한다.
 */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  const name = (process.env.EMBEDDING_PROVIDER ?? "").trim().toLowerCase();
  if (!name) return null;
  const create = PROVIDERS[name];
  if (!create) {
    if (!warned) {
      warned = true;
      log.warn("search.embedding_provider_unknown", { provider: name });
    }
    return null;
  }
  return create();
}

/** pgvector 입력 형식("[0.1,0.2]")으로 바꾼다. 유한한 숫자만 허용한다. */
export function toVectorLiteral(vector: number[]): string {
  if (vector.length === 0 || vector.some((x) => typeof x !== "number" || !Number.isFinite(x))) {
    throw new Error("임베딩 벡터가 올바르지 않습니다.");
  }
  return `[${vector.join(",")}]`;
}
