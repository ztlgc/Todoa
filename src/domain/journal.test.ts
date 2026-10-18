import { describe, expect, it } from "vitest";
import { emptyJournal, filterJournalRecords, journalMarkdown, journalMatches, journalPeriod, parseDateKey, parseJournalInput, summaryMaterials, workStatus, type JournalRecord } from "./journal";

const daily: JournalRecord = { ...emptyJournal("day", "2026-10-07"), title: "导入模块", text: "完成联调", revision: 1, createdAt: "2026-10-07T00:00:00.000Z", updatedAt: "2026-10-07T00:00:00.000Z", deletedAt: null, items: [{ id: "one", taskId: 12, title: "解决重复数据", notes: "保留既有记录", theme: "客户交付", important: true, completedAt: "2026-10-07T01:00:00.000Z" }] };
describe("journal periods and historical content", () => {
  it("uses Monday weeks across a year boundary and leap year months", () => {
    expect(journalPeriod("week", "2027-01-01")).toEqual({ kind: "week", start: "2026-12-28", end: "2027-01-03" });
    expect(journalPeriod("month", "2028-02-20").end).toBe("2028-02-29");
    expect(journalPeriod("year", "2026-10-07")).toEqual({ kind: "year", start: "2026-01-01", end: "2026-12-31" });
    expect(() => parseDateKey("2026-02-30")).toThrow();
    expect(() => parseJournalInput({ ...daily, end: "2026-10-08" })).toThrow();
  });
  it("searches snapshot notes and filters by item theme and achievement", () => {
    expect(journalMatches(daily, "既有", "客户交付", true)).toBe(true);
    expect(journalMatches(daily, "missing", "", false)).toBe(false);
  });
  it("keeps daily and period summaries independent and excludes deleted sources", () => {
    const week: JournalRecord = { ...daily, ...emptyJournal("week", daily.start), text: "本周交付", items: [] };
    const generated = summaryMaterials([daily, week, { ...daily, start: "2026-10-06", end: "2026-10-06", text: "已删除素材", deletedAt: daily.updatedAt }], "week", daily.start);
    expect(generated).toContain("完成联调"); expect(generated).toContain("解决重复数据");
    expect(generated).not.toContain("本周交付"); expect(generated).not.toContain("已删除素材");
    expect(journalMarkdown([daily, week], "year", daily.start, "", "客户交付", true)).toContain("解决重复数据");
    expect(week.text).toBe("本周交付");
  });
  it("exports only records contained in the selected period, without larger summaries", () => {
    const week: JournalRecord = { ...daily, ...emptyJournal("week", daily.start), text: "本周交付", items: [] };
    const year: JournalRecord = { ...daily, ...emptyJournal("year", daily.start), text: "全年成果", items: [] };
    const markdown = journalMarkdown([daily, week, year], "day", daily.start);
    expect(markdown).toContain("完成联调");
    expect(markdown).not.toContain("本周交付");
    expect(markdown).not.toContain("全年成果");
    expect(journalMarkdown([daily, week, year], "year", daily.start)).toContain("全年成果");
  });
  it("keeps customer, business and progress fields while reading legacy snapshots honestly", () => {
    const item = { ...daily.items[0], client: "华兴制造", business: "续贷管理", activity: "phone" as const, status: "waiting_client" as const, nextAction: "催收财报", followUpAt: "2026-10-20T01:00:00.000Z" };
    expect(parseJournalInput({ ...daily, items: [item] }).items[0]).toEqual(item);
    expect(workStatus({ ...daily.items[0], completedAt: null })).toBe("unclassified");
    expect(workStatus(daily.items[0])).toBe("completed");
  });
  it("matches all conditions on the same item and exports only the matching customer", () => {
    const record = { ...daily, text: "涉及多位客户的内部总结", items: [
      { ...daily.items[0], id: "a", client: "华兴制造", business: "续贷管理", status: "waiting_client" as const, important: false },
      { ...daily.items[0], id: "b", title: "另一户开户", client: "远航贸易", status: "completed" as const },
    ] };
    const projected = filterJournalRecords([record], { client: "华兴制造" });
    expect(projected[0].items.map(item => item.id)).toEqual(["a"]);
    expect(filterJournalRecords([record], { client: "华兴制造", status: "completed" })).toEqual([]);
    expect(record.items).toHaveLength(2);
    const output = journalMarkdown([record], "day", "2026-10-17", "", "", false, { allHistory: true, client: "华兴制造" });
    expect(output).toContain("待客户"); expect(output).toContain("华兴制造");
    expect(output).not.toContain("远航贸易"); expect(output).not.toContain("内部总结");
  });
  it("organizes daily facts without duplicating nested weekly or monthly summaries", () => {
    const source = { ...daily, items: [{ ...daily.items[0], client: "华兴制造", status: "waiting_internal" as const, nextAction: "确认审批反馈" }] };
    const week = { ...daily, ...emptyJournal("week", daily.start), text: "不要重复的周总结" };
    const materials = summaryMaterials([source, week], "month", daily.start);
    expect(materials).toContain("等待与阻塞"); expect(materials).toContain("下一步跟进"); expect(materials).toContain("确认审批反馈");
    expect(materials).not.toContain("不要重复的周总结");
    expect(materials.match(/解决重复数据/g)).toHaveLength(1);
  });
});
