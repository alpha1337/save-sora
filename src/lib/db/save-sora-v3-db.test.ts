import { describe, expect, it } from "vitest";
import {
  SAVED_ACCOUNTS_CREATORS_INDEX,
  SAVED_ACCOUNTS_SIDE_CHARACTERS_INDEX,
  SAVED_ACCOUNTS_STORE,
  SAVED_ACCOUNTS_USER_INDEX,
  openSaveSoraV3Db
} from "./save-sora-v3-db";

describe("save-sora-v3-db", () => {
  it("creates dedicated saved_accounts indexes for creators, side characters, and user", async () => {
    const database = await openSaveSoraV3Db();
    const transaction = database.transaction(SAVED_ACCOUNTS_STORE, "readonly");
    const store = transaction.objectStore(SAVED_ACCOUNTS_STORE);
    const indexNames = Array.from(store.indexNames);

    expect(indexNames).toEqual(expect.arrayContaining([
      SAVED_ACCOUNTS_CREATORS_INDEX,
      SAVED_ACCOUNTS_SIDE_CHARACTERS_INDEX,
      SAVED_ACCOUNTS_USER_INDEX
    ]));
    await transaction.done;
  });
});
