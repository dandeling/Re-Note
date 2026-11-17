// 휴지통 30일 경과 항목 영구 삭제. 예: 하루 한 번 cron으로 `pnpm trash:purge`
import "dotenv/config";
import { purgeExpiredTrash } from "@/server/trash";
import { log } from "@/lib/log";

purgeExpiredTrash()
  .then((result) => {
    log.info("trash.purged", result);
    process.exit(0);
  })
  .catch((err) => {
    log.error("trash.purge_failed", { error: String(err) });
    process.exit(1);
  });
