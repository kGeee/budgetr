import { describe, expect, it } from "vitest";
import { sharedVerdict } from "./shared-verdict";

const base = { peopleCount: 3, owing: 2, youOwe: 0, returned: 0 };

describe("sharedVerdict", () => {
  it("explains how to start when the ledger is empty", () => {
    const v = sharedVerdict({ ...base, peopleCount: 0, owing: 0 });
    expect(v.amount).toBeNull();
    expect(v.lead).toMatch(/^Split a transaction/);
  });

  it("is square when nobody owes anybody", () => {
    expect(sharedVerdict({ ...base, owing: 0 })).toMatchObject({
      tone: "jade",
      lead: "Everyone's square.",
    });
  });

  it("puts what you owe first when it is the only balance", () => {
    expect(sharedVerdict({ ...base, owing: 0, youOwe: 40 })).toEqual({
      tone: "coral",
      lead: "Nobody owes you, and you owe",
      amount: 40,
      tail: "back.",
    });
  });

  it("qualifies the headline with what you owe back", () => {
    expect(sharedVerdict({ ...base, youOwe: 12.5, returned: 300 })).toMatchObject({
      tone: "coral",
      lead: "2 people owe you, and you owe",
      amount: 12.5,
    });
  });

  it("otherwise reports what has already come back", () => {
    expect(sharedVerdict({ ...base, owing: 1, returned: 220 })).toEqual({
      tone: "jade",
      lead: "1 person owes you;",
      amount: 220,
      tail: "of what you fronted has already come back.",
    });
  });

  it("just counts heads when nothing has moved yet", () => {
    expect(sharedVerdict(base)).toEqual({
      tone: "muted",
      lead: "2 people owe you.",
      amount: null,
      tail: "",
    });
  });

  it("ignores sub-cent dust", () => {
    expect(sharedVerdict({ ...base, youOwe: 0.004 }).tone).toBe("muted");
  });
});
