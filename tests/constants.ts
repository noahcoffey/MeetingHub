// Dedicated test database in the same local docker postgres as dev
// (docker-compose.dev.yml). Created + migrated by tests/global-setup.ts.
export const TEST_DATABASE_URL =
  "postgres://meetinghub:meetinghub@localhost:5432/meetinghub_test";

// The single seeded user tests hang tokens off (fixed id for FK use).
export const TEST_USER_ID = "11111111-1111-4111-8111-111111111111";
