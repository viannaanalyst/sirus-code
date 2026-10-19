import { useCallback, useEffect, useMemo, useState } from "react";
import { client } from "@/client";
import type { AgentProviderId, UsageHistory, UsagePrices } from "@/client/types";
import { Plus, RefreshCw } from "@/components/icons/phosphor";
import { ProviderAccountsPanel } from "@/components/ProviderAccountsPanel";
import { ProviderIcon } from "@/components/settings/ProviderIcon";
import { useTranslation } from "@/i18n/use-translation";
import { cn } from "@/lib/cn";
import { formatUnknownError } from "@/lib/format-error";
import { activeProviderAccount, providerAccounts, supportsProviderAccounts } from "@/lib/provider-accounts";
import { providerById } from "@/lib/provider-registry";
import { orderedUsageWindows, resetDuration, USAGE_PROVIDER_IDS, usageWindowLabel } from "@/lib/provider-usage";
import { formatCompact, formatShare, formatUsd, sortModelRows, summarizeUsage, USAGE_RANGES, type UsageProvider, type UsageRange, type UsageSummary } from "@/lib/usage-summary";
import { IconButton } from "@/primitives/IconButton";
import { Popover, PopoverContent, PopoverTrigger } from "@/primitives/Popover";
import { SegmentedControl } from "@/primitives/SegmentedControl";
import { selectCurrentSessionMeta, useAppStore } from "@/store/app-store";
import "@/styles/usage-page.css";

type UsageTab = "cost" | "tokens" | "limits";

/** Each provider's colour in the chart and cards (the brand marks' own colours). */
const PROVIDER_COLOR: Record<UsageProvider, string> = { claude: "var(--brand-claude)", codex: "var(--text-secondary)", opencode: "var(--brand-openai)" };

/** The last history and prices stay for the window, so reopening the page shows them at once. */
let lastHistory: UsageHistory | null = null;
let lastPrices: UsagePrices | null = null;

/**
 * The Usage page (ADR-141), opened from the sidebar foot: Cost and Tokens read the provider
 * CLIs' own local logs (one native read of 90 days; ranges are cut here), Limits shows each
 * provider's quota windows and its accounts, with Add account.
 */
export function UsagePage() {
  const t = useTranslation();
  const locale = useAppStore(state => state.settings.locale);
  const [tab, setTab] = useState<UsageTab>("cost");
  const [range, setRange] = useState<UsageRange>(30);
  const [history, setHistory] = useState<UsageHistory | null>(lastHistory);
  const [prices, setPrices] = useState<UsagePrices | null>(lastPrices);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      lastHistory = await client.usageHistory(90);
      setHistory(lastHistory);
      // Prices for the models in the history; without them the built-in list prices apply.
      const models = [...new Set(lastHistory.entries.map(entry => entry.model))];
      lastPrices = await client.usagePrices(models).catch(() => lastPrices);
      setPrices(lastPrices);
    } catch (reason) { setError(formatUnknownError(reason)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const refreshLimits = () => { for (const provider of USAGE_PROVIDER_IDS) void useAppStore.getState().refreshProviderUsage(provider, true); };
  // The clock is read when the data or range changes, not every render.
  const summary = useMemo(() => history ? summarizeUsage(history.entries, range, Date.now(), prices?.prices) : null, [history, range, prices]);

  return <section className="usage-page" aria-label={t("usage.title")}>
    <div className="scroll-thin usage-scroll">
      <div className="usage-column">
        <header className="usage-header">
          <h1 className="ui-title flex-1 text-text-primary">{t("usage.title")}</h1>
          <SegmentedControl label={t("usage.view")} value={tab} onChange={setTab} options={[
            { value: "cost", label: t("usage.cost") }, { value: "tokens", label: t("usage.tokens") }, { value: "limits", label: t("usage.limits") },
          ]} />
          {tab === "limits" ? null : <SegmentedControl label={t("usage.range")} value={String(range)} onChange={value => setRange(Number(value) as UsageRange)}
            options={USAGE_RANGES.map(value => ({ value: String(value), label: value === 1 ? t("usage.range24h") : t("usage.rangeDays", { count: value }) }))} />}
          <IconButton label={t("Refresh usage")} onClick={() => tab === "limits" ? refreshLimits() : void load()} disabled={loading} className="size-7 text-text-muted">
            <RefreshCw size={14} className={loading && tab !== "limits" ? "animate-spin" : undefined} />
          </IconButton>
        </header>
        {tab === "limits" ? <LimitsView /> : <>
          {error ? <p role="alert" className="usage-notice">{t(error)}</p> : null}
          {history?.problems.map(problem => <p key={problem.provider} className="usage-notice">{providerById(problem.provider).name}: {problem.message}</p>)}
          {summary ? <HistoryView summary={summary} metric={tab} range={range} locale={locale} /> : !error ? <p className="usage-empty">{t("usage.reading")}</p> : null}
        </>}
      </div>
    </div>
  </section>;
}

function HistoryView({ summary, metric, range, locale }: { summary: UsageSummary; metric: "cost" | "tokens"; range: UsageRange; locale: string }) {
  const t = useTranslation();
  const isCost = metric === "cost";
  const money = (value: number) => formatUsd(value, locale);
  const count = (value: number) => formatCompact(value, locale);
  const rows = sortModelRows(summary.models, metric);
  const totalRow = isCost ? summary.cost : summary.tokens;
  if (!summary.tokens) return <p className="usage-empty">{t("usage.none")}</p>;
  return <>
    <div className="usage-hero">
      <span className="usage-big tabular-nums">{isCost ? money(summary.cost) : count(summary.tokens)}</span>
      <span className="ui-caption text-text-muted">
        {t("usage.sessions", { count: summary.sessions })} · {range === 1 ? t("usage.past24h") : t("usage.pastDays", { count: range })}
        {isCost ? ` · ${t(summary.partialCost ? "usage.estimatePartial" : "usage.estimate")}` : ""}
      </span>
    </div>
    <div className="usage-cards">
      {summary.providers.map(total => <div key={total.provider} className="usage-card">
        <div className="usage-card-head"><ProviderIcon id={total.provider} size={15} /><span className="flex-1 truncate">{providerById(total.provider).name}</span>
          <span className="tabular-nums">{isCost ? money(total.cost) : count(total.tokens)}</span></div>
        <p className="ui-caption text-text-muted">{t("usage.sessions", { count: total.sessions })} · {isCost ? t("usage.tokenCount", { count: count(total.tokens) }) : money(total.cost)}{total.unpriced && isCost ? ` · ${t("usage.unpricedShort")}` : ""}</p>
        <div className="usage-share" aria-hidden="true"><span style={{ width: `${totalRow ? ((isCost ? total.cost : total.tokens) / totalRow) * 100 : 0}%`, background: PROVIDER_COLOR[total.provider] }} /></div>
      </div>)}
    </div>
    <section className="usage-section" aria-label={t(isCost ? "usage.costPerBucket" : "usage.tokensPerBucket")}>
      <h2 className="usage-heading">{t(isCost ? "usage.costPerBucket" : "usage.tokensPerBucket")}</h2>
      <UsageBars summary={summary} metric={metric} locale={locale} />
    </section>
    <div className="usage-totals">
      {([["usage.processed", count(summary.tokens)], ["usage.cachedInput", count(summary.totals.cachedInput)], ["usage.uncachedInput", count(summary.totals.input)], ["usage.output", count(summary.totals.output)], ["usage.cacheSavings", money(summary.cacheSavings)]] as const).map(([label, value]) =>
        <div key={label} className="usage-total"><span>{t(label)}</span><b className="tabular-nums">{value}</b></div>)}
    </div>
    <ByType summary={summary} metric={metric} locale={locale} />
    <section className="usage-section" aria-label={t("usage.byModel")}>
      <h2 className="usage-heading">{t("usage.byModel")}</h2>
      <table className="usage-table">
        <thead><tr><th>{t("usage.model")}</th><th>{t("usage.cost")}</th><th>{t("usage.share")}</th><th>{t("usage.tokens")}</th></tr></thead>
        <tbody>{rows.map(row => {
          const part = isCost ? row.cost ?? 0 : row.tokens;
          return <tr key={`${row.provider}:${row.model}`}>
            <td><span className="usage-model"><ProviderIcon id={row.provider} size={13} /><span className="truncate">{row.model}</span></span>
              <span className="usage-model-bar" style={{ width: `${Math.max(1.5, totalRow ? (part / totalRow) * 100 : 0)}%`, background: PROVIDER_COLOR[row.provider] }} aria-hidden="true" /></td>
            <td className={row.cost == null ? "text-text-muted" : undefined}>{row.cost == null ? t("usage.unpriced") : money(row.cost)}</td>
            <td>{formatShare(part, totalRow, locale)}</td>
            <td>{count(row.tokens)}</td>
          </tr>;
        })}</tbody>
      </table>
    </section>
  </>;
}

/**
 * Stacked bars per hour or day, one segment per provider. Pointing at a bar (or focusing it
 * from the keyboard) shows a card with the bucket, its total and each provider's part.
 */
function UsageBars({ summary, metric, locale }: { summary: UsageSummary; metric: "cost" | "tokens"; locale: string }) {
  const t = useTranslation();
  const height = 150;
  const [active, setActive] = useState<number | null>(null);
  const value = (bucket: UsageSummary["buckets"][number], provider: UsageProvider) => metric === "cost" ? bucket.values[provider].cost : bucket.values[provider].tokens;
  const sums = summary.buckets.map(bucket => summary.providers.reduce((sum, total) => sum + value(bucket, total.provider), 0));
  const max = Math.max(...sums, 0) || 1;
  const label = (at: number) => summary.bucket === "hour" ? new Date(at).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : new Date(at).toLocaleDateString(locale, { day: "numeric", month: "short" });
  const longLabel = (at: number) => summary.bucket === "hour"
    ? `${new Date(at).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" })} · ${label(at)}–${label(at + 60 * 60 * 1000)}`
    : new Date(at).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  const format = (amount: number) => metric === "cost" ? formatUsd(amount, locale) : formatCompact(amount, locale);
  const ticks = [0, Math.floor((summary.buckets.length - 1) / 2), summary.buckets.length - 1];
  const shown = active == null ? null : summary.buckets[active];
  // The card follows the bar and stays inside the plot at both ends.
  const position = active == null ? 0 : (active + 0.5) / summary.buckets.length;
  return <div className="usage-bars" onPointerLeave={() => setActive(null)}>
    <div className="usage-bars-plot" style={{ height }} role="group" aria-label={t(metric === "cost" ? "usage.costPerBucket" : "usage.tokensPerBucket")}>
      {summary.buckets.map((bucket, index) => <div key={bucket.at} className="usage-bar" data-active={active === index || undefined} tabIndex={0}
        aria-label={`${longLabel(bucket.at)}: ${format(sums[index])}`}
        onPointerEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(current => current === index ? null : current)}>
        {summary.providers.map(total => {
          const amount = value(bucket, total.provider);
          return amount > 0 ? <span key={total.provider} style={{ height: `${(amount / max) * 100}%`, background: PROVIDER_COLOR[total.provider] }} /> : null;
        })}
      </div>)}
      {shown ? <div className="usage-tip" role="tooltip" style={{ left: `clamp(110px, ${position * 100}%, calc(100% - 110px))` }}>
        <p className="usage-tip-date">{longLabel(shown.at)}</p>
        <p className="usage-tip-total tabular-nums">{format(sums[active!])}</p>
        {summary.providers.map(total => {
          const amount = value(shown, total.provider);
          return <p key={total.provider} className="usage-tip-row" data-empty={amount <= 0 || undefined}>
            <i style={{ background: PROVIDER_COLOR[total.provider] }} />
            <span className="flex-1 truncate">{providerById(total.provider).name}</span>
            <span className="tabular-nums">{format(amount)}</span>
          </p>;
        })}
      </div> : null}
    </div>
    <div className="usage-bars-axis">{ticks.map(index => <span key={index}>{label(summary.buckets[index].at)}</span>)}</div>
  </div>;
}

function ByType({ summary, metric, locale }: { summary: UsageSummary; metric: "cost" | "tokens"; locale: string }) {
  const t = useTranslation();
  const parts = metric === "cost"
    ? [["usage.input", summary.costByType.input], ["usage.cacheRead", summary.costByType.cacheRead], ["usage.cacheWrite", summary.costByType.cacheWrite], ["usage.output", summary.costByType.output], ["usage.reported", summary.costByType.reported]] as const
    : [["usage.input", summary.totals.input], ["usage.cacheRead", summary.totals.cachedInput], ["usage.cacheWrite", summary.totals.cacheWrite], ["usage.output", summary.totals.output]] as const;
  const shown = parts.filter(([, amount]) => amount > 0);
  const total = shown.reduce((sum, [, amount]) => sum + amount, 0);
  if (!total) return null;
  return <section className="usage-section" aria-label={t(metric === "cost" ? "usage.costByType" : "usage.tokensByType")}>
    <h2 className="usage-heading">{t(metric === "cost" ? "usage.costByType" : "usage.tokensByType")}</h2>
    <div className="usage-split" aria-hidden="true">{shown.map(([label, amount], index) => <span key={label} data-part={index} style={{ flexGrow: amount }} />)}</div>
    <div className="usage-legend">{shown.map(([label, amount], index) => <span key={label}><i data-part={index} />{t(label)} <b className="tabular-nums">{metric === "cost" ? formatUsd(amount, locale) : formatCompact(amount, locale)}</b></span>)}</div>
  </section>;
}

/** Limits: every provider that reports quota windows, with its accounts and Add account. */
function LimitsView() {
  const disabled = useAppStore(state => state.settings.disabledProviders);
  const providers = USAGE_PROVIDER_IDS.filter(id => !disabled.includes(id));
  useEffect(() => { for (const provider of providers) void useAppStore.getState().refreshProviderUsage(provider); }, [providers.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="usage-limits">{providers.map(provider => <ProviderLimits key={provider} provider={provider} />)}</div>;
}

function ProviderLimits({ provider }: { provider: AgentProviderId }) {
  const t = useTranslation();
  const usage = useAppStore(state => state.usageByProvider[provider]);
  const loading = useAppStore(state => !!state.usageLoading[provider]);
  const profiles = useAppStore(state => state.providerAccounts);
  const selections = useAppStore(state => state.selectedProviderAccounts);
  const session = useAppStore(selectCurrentSessionMeta);
  const locale = useAppStore(state => state.settings.locale);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const name = providerById(provider).name;
  const windows = orderedUsageWindows(usage);
  const accounts = supportsProviderAccounts(provider) ? providerAccounts(provider, profiles) : [];
  const selected = selections[provider] ?? "default";
  const now = Date.now();
  return <section className="usage-provider" aria-label={name}>
    <div className="usage-provider-head">
      <ProviderIcon id={provider} size={16} />
      <h2 className="ui-control font-medium text-text-primary">{name}</h2>
      {usage?.account?.email ? <span className="ui-caption text-text-muted truncate">{usage.account.email}</span> : null}
      {accounts.length > 1 ? <span className="usage-accounts">{accounts.map(account => <span key={account.id} className="usage-account" data-on={account.id === selected || undefined}>{account.id === "default" ? t("Default account") : account.label}</span>)}</span> : null}
      <span className="flex-1" />
      {supportsProviderAccounts(provider) ? <Popover open={accountsOpen} onOpenChange={setAccountsOpen}>
        <PopoverTrigger asChild><button type="button" className="usage-add"><Plus size={13} aria-hidden="true" />{t("Add account")}</button></PopoverTrigger>
        <PopoverContent side="bottom" align="end" sideOffset={6} className="usage-popover scroll-thin max-h-[min(560px,80vh)] w-80 overflow-y-auto p-3">
          <ProviderAccountsPanel provider={provider} name={name} currentId={activeProviderAccount(provider, session, selections)} onBack={() => setAccountsOpen(false)} />
        </PopoverContent>
      </Popover> : null}
    </div>
    {windows.map(window => {
      const used = window.usedPercent;
      const left = used == null ? null : Math.max(0, 100 - Math.round(used));
      const reset = window.resetsAt != null && window.resetsAt > now ? resetDuration(window.resetsAt, now) : null;
      return <div key={window.id} className="usage-window">
        <div><p className="ui-caption text-text-secondary">{t(usageWindowLabel(window))}</p>
          <p className="usage-left tabular-nums">{left == null ? "—" : `${left}%`}<small>{t("usage.left")}</small></p></div>
        <div className="usage-track" role="progressbar" aria-label={t(usageWindowLabel(window))} aria-valuenow={left ?? undefined} aria-valuemin={0} aria-valuemax={100}>
          <span className={cn(used != null && used >= 90 && "usage-track-danger")} style={{ width: `${left ?? 0}%`, background: provider === "claude" ? "var(--brand-claude)" : provider === "codex" ? "var(--text-secondary)" : "var(--brand-openai)" }} />
          {reset ? <em title={new Date(window.resetsAt!).toLocaleString(locale)}>{t("usage.resetsIn", { time: reset })}</em> : null}
        </div>
      </div>;
    })}
    {!windows.length ? <p className={cn("ui-caption", usage?.status === "error" ? "usage-notice" : "text-text-muted")}>{usage?.note ? t(usage.note) : t(loading || !usage ? "common.loading" : "usage.noLimits")}</p> : null}
  </section>;
}
