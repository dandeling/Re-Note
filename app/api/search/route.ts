import { searchSite } from "@/lib/search";
import { searchQuerySchema } from "@/lib/validation/search";
import { json, parseQuery, route } from "@/server/api";
import { clientIp, RATE_LIMITS, rateLimit } from "@/server/rate-limit";

/** 사이트 내부 검색 (SPEC 7.2). 비로그인도 사용할 수 있으므로 IP당 rate limit을 건다. */
export const GET = route(async (req) => {
  await rateLimit(`search:${clientIp(req)}`, RATE_LIMITS.search());
  const { q, limit, kind } = parseQuery(req, searchQuerySchema);
  return json(await searchSite(q, { limit, kinds: kind ? [kind] : undefined }));
});
