import { invoke } from "@tauri-apps/api/core";
import { isBrowserDebug } from "@/app/browserDebug";
import { journalRepository } from "./JournalRepository";
import { emptyJournal, journalPeriod, parseDateKey, parseJournalInput, type JournalRecord } from "@/domain/journal";
import { journalDocument, parseJournalDocument } from "@/domain/journalContent";
import { plainDocument, plainText } from "@/domain/contentDocument";
import { highlightSnapshot, parseHighlightInput, type HighlightInput, type JournalHighlight, type JournalReviewMaterial } from "@/domain/journalReview";
import { parseJournalCompletion, type JournalCompletion } from "@/domain/journalAutomation";

type Source = { type: "highlight" | "month"; id: string };
type Association = { sourceType: Source["type"]; sourceId: string; snapshot: string; sourceRevision: number; highlightIds: string[] };
type ReviewRecord = JournalRecord & { reviewSources?: Association[] };
const messages: Record<string, string> = {
  HIGHLIGHT_CONFLICT: "这条重点已更新，请刷新后重试。", HIGHLIGHT_SOURCE_CONFLICT: "原文已更新，请核对并重新收录。",
  HIGHLIGHT_ALREADY_EXISTS: "这个任务已收录为重点，请打开已有重点。", HIGHLIGHT_SOURCE_UNAVAILABLE: "来源已删除或完成已撤销，无法收录。",
  JOURNAL_CONTENT_CONFLICT: "回顾正文已更新，请刷新后重试。当前输入已保留。", JOURNAL_IN_TRASH: "回顾已在回收站，请先恢复。",
  REVIEW_SOURCE_OVERLAP_USE_HIGHLIGHTS: "这篇月度回顾与已加入的重点重叠，请选用原始重点，避免重复加入。",
  REVIEW_SOURCE_OUT_OF_RANGE: "来源不在当前回顾的日期范围内。", REVIEW_SOURCE_EMPTY: "这篇月度回顾还没有文字。",
};
function error(code: string): Error { return new Error(messages[code] ?? `回顾保存失败（${code}）。`); }
async function native<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(command, args); }
  catch (cause) { throw Object.assign(error(String(cause)), { cause }); }
}
function period(kind: "month" | "year", start: string) {
  if (!["month", "year"].includes(kind)) throw error("INVALID_REVIEW_SOURCE");
  const p = journalPeriod(kind, start);
  if (p.start !== start) throw error("INVALID_REVIEW_SOURCE");
  return p;
}
function revision(value: number) { if (!Number.isSafeInteger(value) || value < 0) throw error("INVALID_REVISION"); }
export class JournalReviewRepository {
  constructor(private browser = isBrowserDebug, private storage: () => Storage = () => localStorage, private namespace: () => string = () => journalRepository.draftNamespace) {}
  private records(): ReviewRecord[] {
    const raw: unknown = JSON.parse(this.storage().getItem(this.namespace()) ?? "[]");
    if (!Array.isArray(raw)) throw error("INVALID_JOURNAL_STORAGE");
    return raw.map((r: ReviewRecord) => {
      parseJournalInput(r);
      if (!Number.isSafeInteger(r.revision) || r.revision < 1) throw error("INVALID_JOURNAL_STORAGE");
      if (r.contentJson) parseJournalDocument(r.contentJson);
      if (r.reviewSources !== undefined && (!Array.isArray(r.reviewSources) || r.reviewSources.some(s => !["highlight", "month"].includes(s.sourceType) || typeof s.sourceId !== "string" || typeof s.snapshot !== "string" || !Number.isSafeInteger(s.sourceRevision) || s.sourceRevision < 0 || !Array.isArray(s.highlightIds) || s.highlightIds.some(id => typeof id !== "string")))) throw error("INVALID_REVIEW_SOURCE");
      // Keep all extension fields, including associations, on the original record.
      return r;
    });
  }
  private highlights(): JournalHighlight[] {
    const raw: unknown = JSON.parse(this.storage().getItem(`${this.namespace()}.review.v1`) ?? "[]");
    if (!Array.isArray(raw)) throw error("INVALID_REVIEW_STORAGE");
    return raw.map((h: JournalHighlight) => {
      parseHighlightInput(h);
      if (!Number.isSafeInteger(h.revision) || h.revision < 1 || typeof h.createdAt !== "string" || typeof h.updatedAt !== "string" || (h.deletedAt !== null && typeof h.deletedAt !== "string")) throw error("INVALID_REVIEW_STORAGE");
      return h;
    });
  }
  private completions(): JournalCompletion[] {
    const raw: unknown = JSON.parse(this.storage().getItem(`${this.namespace()}.task-completions.v1`) ?? "[]");
    if (!Array.isArray(raw)) throw error("INVALID_JOURNAL_STORAGE");
    return raw.map(parseJournalCompletion);
  }
  private status(h: JournalHighlight, records: ReviewRecord[], tasks: JournalCompletion[]): JournalHighlight {
    const day = records.find(r => r.kind === "day" && r.start === h.date);
    const task = tasks.find(t => t.day === h.date && t.item.id === h.sourceId);
    const missing = h.sourceType === "task" ? !task : h.sourceType === "legacy" && (!day || !day.items.some(i => i.id === h.sourceId && i.origin !== "task_auto"));
    return { ...h, sourceDeleted: !!day?.deletedAt || missing, sourceChanged: h.sourceType !== "task" && (day?.contentRevision ?? 0) !== h.sourceRevision, sourceRevoked: h.sourceType === "task" && !!task?.item.revokedAt };
  }
  async list(from: string, to: string, options?: { includeUnavailable?: boolean }): Promise<JournalHighlight[]> {
    parseDateKey(from); parseDateKey(to); if (from > to) throw error("INVALID_JOURNAL_DATE");
    if (!this.browser()) return native("list_journal_highlights", { from, to, includeUnavailable: !!options?.includeUnavailable });
    const records = this.records(), tasks = this.completions();
    return this.highlights().filter(h => !h.deletedAt && h.date >= from && h.date <= to).map(h => this.status(h, records, tasks)).filter(h => options?.includeUnavailable || (!h.sourceDeleted && !h.sourceRevoked)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }
  async save(input: HighlightInput, currentRevision: number): Promise<void> {
    const parsed = parseHighlightInput(input); revision(currentRevision);
    if (!this.browser()) return native("save_journal_highlight", { input: parsed, revision: currentRevision });
    const items = this.highlights(), old = items.find(h => h.id === parsed.id), now = new Date().toISOString();
    if ((old?.revision ?? 0) !== currentRevision) throw error("HIGHLIGHT_CONFLICT");
    if (old && (old.date !== parsed.date || old.sourceType !== parsed.sourceType || old.sourceId !== parsed.sourceId)) throw error("INVALID_HIGHLIGHT_SOURCE");
    const h = this.status({ ...parsed, revision: currentRevision + 1, createdAt: old?.createdAt ?? now, updatedAt: now, deletedAt: null, sourceDeleted: false, sourceChanged: false, sourceRevoked: false }, this.records(), this.completions());
    if (h.sourceDeleted || h.sourceRevoked) throw error("HIGHLIGHT_SOURCE_UNAVAILABLE");
    if (h.sourceChanged) throw error("HIGHLIGHT_SOURCE_CONFLICT");
    if (h.sourceType === "task" && items.some(i => i.id !== h.id && !i.deletedAt && i.sourceType === "task" && i.sourceId === h.sourceId)) throw error("HIGHLIGHT_ALREADY_EXISTS");
    this.storage().setItem(`${this.namespace()}.review.v1`, JSON.stringify([...items.filter(i => i !== old), h]));
  }
  async remove(item: JournalHighlight): Promise<void> {
    revision(item.revision);
    if (!this.browser()) return native("remove_journal_highlight", { id: item.id, revision: item.revision });
    const items = this.highlights(), current = items.find(h => h.id === item.id && !h.deletedAt);
    if (!current || current.revision !== item.revision) throw error("HIGHLIGHT_CONFLICT");
    const now = new Date().toISOString();
    this.storage().setItem(`${this.namespace()}.review.v1`, JSON.stringify(items.map(h => h === current ? { ...h, revision: h.revision + 1, deletedAt: now, updatedAt: now } : h)));
  }
  async addMaterial(kind: "month" | "year", start: string, source: Source, contentRevision: number): Promise<void> {
    const p = period(kind, start); revision(contentRevision);
    if (typeof source.id !== "string" || !source.id || source.id.length > 100 || source.id.includes("\0")) throw error("INVALID_REVIEW_SOURCE");
    if (!this.browser()) return native("add_journal_review_material", { kind, start, sourceType: source.type, sourceId: source.id, contentRevision });
    // No await between reading and publishing. Body and associations share one
    // localStorage value: quota failures leave both, and all existing drafts, intact.
    const records = this.records(), current = records.find(r => r.kind === kind && r.start === start), associations = current?.reviewSources ?? [];
    if (associations.some(s => s.sourceType === source.type && s.sourceId === source.id)) return;
    if (current?.deletedAt) throw error("JOURNAL_IN_TRASH");
    if ((current?.contentRevision ?? 0) !== contentRevision) throw error("JOURNAL_CONTENT_CONFLICT");
    let snapshot: string, sourceRevision: number, highlightIds: string[];
    if (source.type === "highlight") {
      const raw = this.highlights().find(h => h.id === source.id && !h.deletedAt);
      if (!raw) throw error("HIGHLIGHT_SOURCE_UNAVAILABLE");
      const h = this.status(raw, records, this.completions());
      if (h.sourceDeleted || h.sourceRevoked) throw error("HIGHLIGHT_SOURCE_UNAVAILABLE");
      if (h.date < start || h.date > p.end) throw error("REVIEW_SOURCE_OUT_OF_RANGE");
      snapshot = highlightSnapshot(h); sourceRevision = h.revision; highlightIds = [h.id];
    } else if (source.type === "month" && kind === "year") {
      const mp = period("month", source.id);
      if (mp.start < start || mp.end > p.end) throw error("REVIEW_SOURCE_OUT_OF_RANGE");
      const month = records.find(r => r.kind === "month" && r.start === source.id && !r.deletedAt);
      if (!month) throw error("REVIEW_SOURCE_NOT_FOUND");
      const text = plainText(journalDocument(month)); if (!text) throw error("REVIEW_SOURCE_EMPTY");
      snapshot = `${source.id.slice(0, 7)} 月度回顾\n${text}\n来源：${source.id} 月度回顾`;
      sourceRevision = month.revision; highlightIds = [...new Set((month.reviewSources ?? []).flatMap(s => s.highlightIds))];
    } else throw error("INVALID_REVIEW_SOURCE");
    if (associations.some(s => s.highlightIds.some(id => highlightIds.includes(id)))) throw error("REVIEW_SOURCE_OVERLAP_USE_HIGHLIGHTS");
    const doc = journalDocument(current);
    const parsed = parseJournalDocument({ ...doc, content: [...(doc.content ?? []), { type: "paragraph" }, ...(plainDocument(snapshot).content ?? [])] });
    const now = new Date().toISOString();
    const next: ReviewRecord = { ...emptyJournal(kind, start), ...current, text: parsed.text, contentJson: parsed.json, contentRevision: contentRevision + 1, revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? now, updatedAt: now, deletedAt: null, reviewSources: [...associations, { sourceType: source.type, sourceId: source.id, snapshot, sourceRevision, highlightIds }] };
    this.storage().setItem(this.namespace(), JSON.stringify([...records.filter(r => r !== current), next]));
  }
  async materials(kind: "month" | "year", start: string): Promise<JournalReviewMaterial[]> {
    period(kind, start);
    if (!this.browser()) return native("journal_review_materials", { kind, start });
    const records = this.records(), highlights = this.highlights(), tasks = this.completions();
    const state = (id: string) => { const h = highlights.find(h => h.id === id); return h ? this.status(h, records, tasks) : undefined; };
    return (records.find(r => r.kind === kind && r.start === start)?.reviewSources ?? []).map(s => {
      if (s.sourceType === "highlight") {
        const h = state(s.sourceId);
        return { sourceType: s.sourceType, sourceId: s.sourceId, snapshot: s.snapshot, sourceDeleted: !h || !!h.deletedAt || h.sourceDeleted, sourceChanged: !!h && (h.revision !== s.sourceRevision || h.sourceChanged), sourceRevoked: !!h?.sourceRevoked };
      }
      const month = records.find(r => r.kind === "month" && r.start === s.sourceId), sources = s.highlightIds.map(state);
      return { sourceType: s.sourceType, sourceId: s.sourceId, snapshot: s.snapshot, sourceDeleted: !month || !!month.deletedAt || sources.some(h => !h || !!h.deletedAt || h.sourceDeleted), sourceChanged: (!!month && month.revision !== s.sourceRevision) || sources.some(h => h?.sourceChanged), sourceRevoked: sources.some(h => h?.sourceRevoked) };
    });
  }
}
export const journalReviewRepository = new JournalReviewRepository();
