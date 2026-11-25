import { describe, expect, it } from "vitest";
import { questionDates, questionFilters, followUp, changeQuestion, localAnswer } from "../lib/assistant";
import { state, input } from "../lib/workspace";

const m = state([], input({ asOf: "2025-03-20" })).snap;

describe("copilot question parsing", () => {
  it("reads ISO, day-month and month-day dates, defaulting to the season year", () => {
    expect(questionDates("Confirmed value as of 15 Mar 2025?", "2025")).toEqual(["2025-03-15"]);
    expect(questionDates("as of 2025-04-11", "2025")).toEqual(["2025-04-11"]);
    expect(questionDates("on March 20th", "2025")).toEqual(["2025-03-20"]);
    expect(questionDates("between 15 Mar and 20 Mar", "2025")).toEqual(["2025-03-15", "2025-03-20"]);
  });
  it("ignores numbers that are not dates", () => {
    expect(questionDates("May 3 deals close this week?", "2025")).toEqual([]);
    expect(questionDates("31 Feb 2025", "2025")).toEqual([]);
  });
  it("applies scoped filters and clears them on request", () => {
    expect(questionFilters("Now only LinkedIn", m, {}).channel).toBe("linkedin");
    expect(questionFilters("Now just Education", m, {}).industry).toBe("Education");
    expect(questionFilters("only Nisha's deals", m, {}).owner).toBe("T05");
    expect(questionFilters("Now all channels", m, { channel: "linkedin" }).channel).toBe("");
    expect(questionFilters("Why are we behind on partnerships?", m, {})).toEqual({});
  });
  it("spots follow-ups and change questions", () => {
    expect(followUp("And a month earlier?")).toBe(true);
    expect(followUp("Why are we behind on partnerships?")).toBe(false);
    expect(changeQuestion("What changed since 15 March?")).toBe(true);
  });
});

describe("local copilot answers", () => {
  it("declines questions the data cannot support and names the missing data", () => {
    for (const [q, needed] of [
      ["Which sponsors will renew next year?", "Renewal history"],
      ["Why did we lose deals?", "Lost reasons"],
      ["How much did we actually spend on LinkedIn?", "spend"],
    ]) {
      const r = localAnswer(state([], input({ asOf: "2025-03-20" })), q);
      expect(r.answer).toContain("cannot support");
      expect(r.missingData.join(" ")).toContain(needed);
    }
  });
  it("labels small segments as directional", () => {
    const r = localAnswer(state([], input({ asOf: "2025-03-20" })), "Which industry wins most?");
    expect(r.answer).toContain("directional");
    expect(r.evidence.length).toBeGreaterThan(0);
  });
});
