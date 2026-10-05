import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, Check, ChevronDown, Ellipsis, GitPullRequest, ListFilter, MessageSquare, Pin, Search, TriangleAlert, X, RefreshCw, Eraser } from "@/components/icons/phosphor";
import { ItemStateIcon } from "@/components/pull-requests/ItemStateIcon";
import type { GithubInbox, GithubItem, GithubItemKind, GithubItemState } from "@/client/types";
import { PullRequestDetail } from "@/components/pull-requests/PullRequestDetail";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";
import { defaultInboxFilters, filterInbox, inboxSections, itemKey, labelCounts, type InboxFilters, type Involvement } from "@/lib/github-inbox";
import { relativeTime } from "@/lib/session-board";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/primitives/Dropdown";
import { useAppStore } from "@/store/app-store";
import "@/styles/review-inbox.css";

type Scope = "all" | GithubItemKind;
type Sort = "updated" | "created" | "comments";
const INVOLVEMENT: Involvement[] = ["anyone", "reviewRequested", "authored", "involving", "assigned"];
const STATES: GithubItemState[] = ["open", "closed", "merged"];

/** One list from the per-kind native lists (issues have no merged state). */
function combine(lists: (GithubInbox | null | undefined)[]): GithubInbox | null {
  const present = lists.filter((list): list is GithubInbox => !!list);
  if (!present.length) return null;
  const failures = new Map(present.flatMap((list) => list.failures).map((failure) => [failure.repository, failure]));
  return {
    viewer: present.find((list) => list.viewer)?.viewer ?? null,
    repositories: present[0].repositories,
    items: present.flatMap((list) => list.items),
    failures: [...failures.values()],
    checkedAt: present[0].checkedAt,
  };
}

/**
 * Review inbox (ADR-050), laid out like Synara's Code review: the list column
 * (search, scope tabs, sort/filter/more) beside the selected item's detail.
 * No polling: lists load when the page opens, when the window returns and on Refresh.
 */
export function PullRequestsPage() {
  const t = useTranslation();
  const [scope, setScope] = useState<Scope>("all");
  const [state, setState] = useState<GithubItemState>("open");
  const [sort, setSort] = useState<Sort>("updated");
  const [filters, setFilters] = useState<InboxFilters>(defaultInboxFilters);
  const [selected, setSelected] = useState<string | null>(() => useAppStore.getState().pullsSelection);
  // A chat link can ask for an item while this page is already open.
  const requested = useAppStore((store) => store.pullsSelection);
  const [seen, setSeen] = useState(requested);
  if (requested !== seen) { setSeen(requested); if (requested) setSelected(requested); }
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const inboxes = useAppStore((store) => store.githubInbox);
  const load = useAppStore((store) => store.loadGithubInbox);
  const projects = useAppStore((store) => store.projects);
  const pins = useAppStore((store) => store.settings.githubPins);
  const issueState: GithubItemState = state === "merged" ? "closed" : state;
  const pulls = inboxes[`pullRequest:${state}`];
  const issues = inboxes[`issue:${issueState}`];
  const loading = !!pulls?.loading || (state !== "merged" && !!issues?.loading);
  const error = pulls?.error ?? issues?.error ?? null;
  const reload = () => { void load("pullRequest", state); if (state !== "merged") void load("issue", issueState); };

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void load("pullRequest", state);
      if (state !== "merged") void load("issue", state);
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [state, load]);

  const all = useMemo(() => combine([pulls?.data, state === "merged" ? null : issues?.data]), [pulls?.data, issues?.data, state]);
  const filtered = useMemo(() => {
    if (!all) return [];
    const list = filterInbox(all, filters);
    const order = sort === "created" ? (item: GithubItem) => item.createdAt : sort === "comments" ? (item: GithubItem) => String(item.commentCount).padStart(8, "0") : (item: GithubItem) => item.updatedAt;
    return [...list].sort((a, b) => order(b).localeCompare(order(a)));
  }, [all, filters, sort]);
  const counts = { all: filtered.length, pullRequest: filtered.filter((item) => item.kind === "pullRequest").length, issue: filtered.filter((item) => item.kind === "issue").length };
  const items = scope === "all" ? filtered : filtered.filter((item) => item.kind === scope);
  const sections = useMemo(() => inboxSections(items, all?.viewer ?? null, pins), [items, all?.viewer, pins]);
  const labels = useMemo(() => all ? labelCounts(all.items) : [], [all]);
  const selectedItem = selected ? all?.items.find((item) => itemKey(item) === selected) ?? null : null;
  const activeFilters = (filters.involvement !== "anyone" ? 1 : 0) + filters.projectIds.length + filters.labels.length + (state !== "open" ? 1 : 0);
  const togglePin = (item: GithubItem) => {
    const store = useAppStore.getState();
    const key = itemKey(item);
    const next = store.settings.githubPins.includes(key) ? store.settings.githubPins.filter((pin) => pin !== key) : [...store.settings.githubPins, key];
    void store.saveSettings({ ...store.settings, githubPins: next });
  };
  const toggle = <K extends "projectIds" | "labels">(field: K, value: string) =>
    setFilters((prev) => ({ ...prev, [field]: prev[field].includes(value) ? prev[field].filter((entry) => entry !== value) : [...prev[field], value] }));
  const clear = () => { setFilters(defaultInboxFilters); setState("open"); };
  const signIn = all?.failures.find((failure) => failure.status === "cliMissing" || failure.status === "authRequired");
  const unavailable = all?.failures.filter((failure) => failure !== signIn).length ?? 0;

  return <section className="pulls-page" aria-label={t("pulls.title")}>
    <div className="pulls-list-column">
      <div className="pulls-list-header">
        <div className="flex items-center gap-1">
          <h1 className="ui-title flex-1 text-text-primary">{t("pulls.title")}</h1>
          <Dropdown>
            <DropdownTrigger asChild><button type="button" className="pulls-icon-button" aria-label={t("pulls.sort")} title={t("pulls.sort")}><ArrowUpDown size={16} /></button></DropdownTrigger>
            <DropdownContent align="end" side="bottom">
              {(["updated", "created", "comments"] as const).map((value) => <DropdownItem key={value} onSelect={() => setSort(value)}><Choice on={sort === value}>{t(`pulls.sort.${value}`)}</Choice></DropdownItem>)}
            </DropdownContent>
          </Dropdown>
          <Dropdown>
            <DropdownTrigger asChild><button type="button" className="pulls-icon-button" aria-label={t("pulls.filters")} title={t("pulls.filters")}><ListFilter size={16} />{activeFilters ? <span className="pulls-filter-count tabular-nums">{activeFilters}</span> : null}</button></DropdownTrigger>
            <DropdownContent align="end" side="bottom" className="max-h-[70vh] min-w-[220px] overflow-y-auto">
              <p className="px-2 py-1 ui-caption text-text-muted">{t("pulls.status")}</p>
              {STATES.map((value) => <DropdownItem key={value} onSelect={() => { setState(value); setSelected(null); }}><Choice on={state === value}>{t(`pulls.state.${value}`)}</Choice></DropdownItem>)}
              <DropdownSeparator />
              <p className="px-2 py-1 ui-caption text-text-muted">{t("pulls.involvement")}</p>
              {INVOLVEMENT.map((value) => <DropdownItem key={value} onSelect={() => setFilters((prev) => ({ ...prev, involvement: value }))}><Choice on={filters.involvement === value}>{t(`pulls.involvement.${value}`)}</Choice></DropdownItem>)}
              {projects.length > 1 ? <><DropdownSeparator /><p className="px-2 py-1 ui-caption text-text-muted">{t("Projects")}</p>
                {projects.filter((project) => all?.repositories.some((repo) => repo.projectIds.includes(project.id))).map((project) => <DropdownItem key={project.id} onSelect={(event) => { event.preventDefault(); toggle("projectIds", project.id); }}><Choice on={filters.projectIds.includes(project.id)}>{project.name}</Choice></DropdownItem>)}</> : null}
              {labels.length ? <><DropdownSeparator /><p className="px-2 py-1 ui-caption text-text-muted">{t("pulls.labels")}</p>
                {labels.slice(0, 30).map(([name, total]) => <DropdownItem key={name} onSelect={(event) => { event.preventDefault(); toggle("labels", name); }}><Choice on={filters.labels.includes(name)} trailing={String(total)}>{name}</Choice></DropdownItem>)}</> : null}
            </DropdownContent>
          </Dropdown>
          <Dropdown>
            <DropdownTrigger asChild><button type="button" className="pulls-icon-button" aria-label={t("pulls.more")} title={t("pulls.more")}><Ellipsis size={16} /></button></DropdownTrigger>
            <DropdownContent align="end" side="bottom">
              <DropdownItem icon={<RefreshCw size={15} />} disabled={loading} onSelect={reload}>{t("pulls.refresh")}</DropdownItem>
              <DropdownItem icon={<Eraser size={15} />} disabled={!activeFilters && !filters.query} onSelect={clear}>{t("pulls.clearFilters")}</DropdownItem>
            </DropdownContent>
          </Dropdown>
        </div>
        <label className="pulls-search">
          <Search size={14} aria-hidden="true" className="shrink-0 text-text-muted" />
          <input type="search" value={filters.query} onChange={(event) => setFilters((prev) => ({ ...prev, query: event.target.value }))} placeholder={t("pulls.search")} aria-label={t("pulls.search")}
            spellCheck={false} autoComplete="off" autoCorrect="off" className="min-w-0 flex-1 bg-transparent ui-control text-text-primary outline-none placeholder:text-text-muted" />
        </label>
        <div className="pulls-scope" role="tablist" aria-label={t("pulls.kind")}>
          {(["all", "pullRequest", "issue"] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={scope === value} className="pulls-scope-tab ui-caption" onClick={() => setScope(value)}>
            {t(`pulls.scope.${value}`)}<span className="tabular-nums">{value === "all" ? counts.all : counts[value]}</span>
          </button>)}
        </div>
        {activeFilters ? <div className="pulls-chips">
          {state !== "open" ? <Chip label={t(`pulls.state.${state}`)} onRemove={() => setState("open")} /> : null}
          {filters.involvement !== "anyone" ? <Chip label={t(`pulls.involvement.${filters.involvement}`)} onRemove={() => setFilters((prev) => ({ ...prev, involvement: "anyone" }))} /> : null}
          {filters.projectIds.map((id) => <Chip key={id} label={projects.find((project) => project.id === id)?.name ?? id} onRemove={() => toggle("projectIds", id)} />)}
          {filters.labels.map((name) => <Chip key={name} label={name} onRemove={() => toggle("labels", name)} />)}
        </div> : null}
      </div>
      <div role="list" className="scroll-thin pulls-list">
        {error ? <p role="alert" className="pulls-banner pulls-banner-danger ui-control">{t(error)}</p> : null}
        {signIn ? <p role="status" className="pulls-banner ui-control">{t(signIn.status === "cliMissing" ? "pulls.ghMissing" : "pulls.ghAuth")}</p> : null}
        {!all && loading ? <p role="status" className="pulls-empty-hint ui-description">{t("common.loading")}</p> : null}
        {all && all.repositories.length === 0 ? <Empty title={t("pulls.noRepositoriesTitle")} hint={t("pulls.noRepositories")} /> : null}
        {all && all.repositories.length > 0 && items.length === 0 && !signIn ? <Empty title={t(`pulls.empty.${scope}`)} hint={t(activeFilters || filters.query ? "pulls.emptyHint" : "pulls.emptyRepos")} /> : null}
        {sections.map((section) => <div key={section.key} className="pulls-section">
          <button type="button" className="pulls-section-label ui-caption" aria-expanded={!collapsed[section.key]} onClick={() => setCollapsed((prev) => ({ ...prev, [section.key]: !prev[section.key] }))}>
            <ChevronDown size={12} className={cn("transition-transform", collapsed[section.key] && "-rotate-90")} />{t(section.label)}<span className="tabular-nums">{section.items.length}</span>
          </button>
          {!collapsed[section.key] ? section.items.map((item) => <Row key={itemKey(item)} item={item} active={selected === itemKey(item)} pinned={pins.includes(itemKey(item))} onSelect={() => setSelected(itemKey(item))} onPin={() => togglePin(item)} />) : null}
        </div>)}
        {unavailable ? <p role="status" className="pulls-banner pulls-banner-warning ui-control"><TriangleAlert size={14} className="shrink-0" />{t(unavailable === 1 ? "pulls.unavailableOne" : "pulls.unavailableMany", { count: unavailable })}</p> : null}
      </div>
    </div>
    <div className="pulls-detail-column">
      {selectedItem ? <PullRequestDetail key={itemKey(selectedItem)} item={selectedItem} projectIds={all?.repositories.find((repo) => repo.repository.toLowerCase() === selectedItem.repository.toLowerCase())?.projectIds ?? []} onChanged={reload} />
        : <div className="pulls-pick">
          <GitPullRequest size={26} strokeWidth={1.5} className="text-text-muted" />
          <p className="ui-control text-text-primary">{t("pulls.pickTitle")}</p>
          <p className="ui-description text-text-muted">{t("pulls.pickHint")}</p>
        </div>}
    </div>
  </section>;
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return <div className="pulls-empty"><p className="ui-title text-text-primary">{title}</p><p className="ui-description text-text-muted">{hint}</p></div>;
}

function Choice({ on, trailing, children }: { on: boolean; trailing?: string; children: string }) {
  return <span className="flex min-w-[180px] items-center gap-2"><span className="min-w-0 flex-1 truncate">{children}</span>{trailing ? <span className="tabular-nums text-text-muted">{trailing}</span> : null}{on ? <Check size={13} /> : <span className="w-[13px]" />}</span>;
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  const t = useTranslation();
  return <span className="pulls-chip ui-caption">{label}<button type="button" aria-label={t("pulls.removeFilter", { filter: label })} onClick={onRemove}><X size={11} /></button></span>;
}

function Row({ item, active, pinned, onSelect, onPin }: { item: GithubItem; active: boolean; pinned: boolean; onSelect: () => void; onPin: () => void }) {
  const t = useTranslation();
  const time = relativeTime(item.updatedAt);
  return <div role="listitem" className={cn("pulls-row group", active && "pulls-row-active")}>
    <button type="button" className="pulls-row-open" aria-current={active || undefined} onClick={onSelect}>
      <span className="pulls-row-icon"><ItemStateIcon item={item} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate ui-control text-text-primary">{item.title}</span>
        <span className="flex items-center gap-1.5 truncate ui-caption text-text-muted">
          <span className="truncate">{item.repository.split("/")[1]} #{item.number}</span>
          {item.author ? <span className="truncate">· {item.author}</span> : null}
          <span>· {time === "now" ? t("Now") : time}</span>
          {item.checks ? <span className={cn("pulls-check-dot", `pulls-check-${item.checks.toLowerCase()}`)} title={t(`pulls.checks.${item.checks.toLowerCase()}`)} /> : null}
          {item.commentCount ? <span className="inline-flex items-center gap-0.5"><MessageSquare size={11} />{item.commentCount}</span> : null}
        </span>
      </span>
    </button>
    <button type="button" className={cn("pulls-pin", pinned && "pulls-pin-on")} aria-pressed={pinned} aria-label={t(pinned ? "pulls.unpin" : "pulls.pin")} title={t(pinned ? "pulls.unpin" : "pulls.pin")} onClick={onPin}><Pin size={12} fill={pinned ? "currentColor" : "none"} /></button>
  </div>;
}
