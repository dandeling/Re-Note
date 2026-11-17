// 테스트는 전용 DB(researchmate_test)를 사용한다. TEST_DATABASE_URL로 교체 가능.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://researchmate:researchmate@localhost:5432/researchmate_test";
process.env.DATABASE_URL = TEST_DATABASE_URL;
