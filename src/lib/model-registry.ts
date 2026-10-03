import type { AgentProviderId, AppSettings, DiscoveredModel, ProviderModelList } from "@/client/types";
import { PROVIDERS } from "@/lib/provider-registry";
import { resolveModelBrand, type ModelBrand } from "@/lib/model-brand-resolver";
import { isModelFavorite, isProviderEnabled } from "@/lib/settings";

export interface ModelRow {
  provider: AgentProviderId;
  model: DiscoveredModel;
  brand: ModelBrand;
  providerEnabled: boolean;
  favorite: boolean;
  /** Catalogs do not prove model-specific vision/tool abilities. */
  capabilities: readonly string[] | null;
}

const naturalNameOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function modelGeneration(row: ModelRow): { family: string; version: number[]; name: string } {
  const name = modelDisplayName(row.provider, row.model.displayName);
  // Compare offered version labels, not context sizes, parameter counts or inferred release dates.
  const versionLabel = name.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (date) => " ".repeat(date.length));
  const match = /(?:^|[^\d])(\d{1,3}(?:[.-]\d{1,3})*)(?=$|[\s/_()-])/.exec(versionLabel);
  const version = match ? match[1].split(/[.-]/).map(Number) : [];
  const brand = row.brand === "codex" ? "openai" : row.brand;
  const prefix = match ? name.slice(0, match.index + match[0].indexOf(match[1])) : name;
  // Unrecognized model vendors must not share a generation sequence merely because of their CLI.
  const family = ["cursor", "opencode", "unknown"].includes(brand)
    ? `${brand}:${prefix.toLowerCase().replace(/[\s/_-]+$/g, "")}`
    : brand;
  return { family, version, name };
}

/** Newer numeric generations first within a brand; exact native IDs remain untouched. */
function compareModelGenerations(a: ModelRow, b: ModelRow): number {
  const left = modelGeneration(a);
  const right = modelGeneration(b);
  const familyOrder = naturalNameOrder.compare(left.family, right.family);
  if (familyOrder) return familyOrder;
  for (let index = 0; index < Math.max(left.version.length, right.version.length); index++) {
    const difference = (right.version[index] ?? 0) - (left.version[index] ?? 0);
    if (difference) return difference;
  }
  return naturalNameOrder.compare(left.name, right.name) || naturalNameOrder.compare(a.model.id, b.model.id);
}

/** Compose the existing catalog and preferences. Every model of an enabled provider is offered. */
export function catalogModels(catalogs: Partial<Record<AgentProviderId, ProviderModelList>>, settings: AppSettings): ModelRow[] {
  const rows: ModelRow[] = [];
  for (const definition of PROVIDERS) {
    for (const model of catalogs[definition.id]?.models ?? []) {
      rows.push({
        provider: definition.id,
        model,
        brand: resolveModelBrand(model.id, definition.id),
        providerEnabled: isProviderEnabled(settings, definition.id),
        favorite: isModelFavorite(settings, definition.id, model.id),
        capabilities: null,
      });
    }
  }
  const providerOrder = new Map(PROVIDERS.map(({ id }, index) => [id, index]));
  return rows.sort((a, b) => providerOrder.get(a.provider)! - providerOrder.get(b.provider)! || compareModelGenerations(a, b));
}

export function visibleModels(catalogs: Partial<Record<AgentProviderId, ProviderModelList>>, settings: AppSettings, query: string): ModelRow[] {
  const needle = query.trim().toLowerCase();
  return catalogModels(catalogs, settings).filter((row) => {
    if (!row.providerEnabled || row.model.availability !== "available") return false;
    const definition = PROVIDERS.find((provider) => provider.id === row.provider)!;
    return !needle || `${row.model.id} ${row.model.displayName} ${definition.name}`.toLowerCase().includes(needle);
  }).sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
    return compareModelGenerations(a, b);
  });
}

export interface ModelChoice extends ModelRow {
  displayName: string;
  /** Exact catalog IDs, never reconstructed from the presentation name. */
  variantIds: string[];
  favoriteModelIds: string[];
}

export type ModelPickerScope = AgentProviderId | "favorites";

/** Favorites may span providers; browsing never changes the selected provider or exact model ID. */
export function pickerModelChoices(
  catalogs: Partial<Record<AgentProviderId, ProviderModelList>>,
  settings: AppSettings,
  installedProviders: readonly AgentProviderId[],
  scope: ModelPickerScope,
  currentProvider: AgentProviderId,
  currentModel: string | null,
  query: string,
): ModelChoice[] {
  const providers = scope === "favorites" ? installedProviders : installedProviders.filter((id) => id === scope);
  const rows = providers.flatMap((id) => providerModelChoices(catalogs, settings, id, id === currentProvider ? currentModel : null, query));
  return scope === "favorites" ? rows.filter((row) => row.favorite) : rows;
}

/** Cursor exposes effort/context presets as separate catalog entries. Settings keeps them intact. */
export function modelDisplayName(provider: AgentProviderId, name: string, catalogNames: readonly string[] = []): string {
  // Presentation only: retain exact native IDs for catalogs, sends and resumes.
  const unqualify = (label: string) => (label.startsWith(`${provider}::`) ? label.slice(provider.length + 2) : label).replace(/^(?:[^\s/]+\/)+(?=[^\s/])/, "");
  name = unqualify(name);
  if (provider !== "cursor") return name;
  const stripPresets = (label: string) => {
    const cleaned = label.replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
    return cleaned.replace(/(?:\s+(?:\d+(?:\.\d+)?[KM](?:\s+Max)?|Extra High|XHigh|Thinking|Low|Medium|High|Fast|None|Minimal|\(default\)|\(NO ZDR\)))+$/i, "") || cleaned;
  };
  const base = stripPresets(name);
  const withoutMax = base.replace(/\s+Max$/i, "");
  // Standalone Max may be a family name. Collapse it only when the CLI offers its sibling.
  return withoutMax !== base && catalogNames.some((sibling) => stripPresets(unqualify(sibling)) === withoutMax) ? withoutMax : base;
}

/** One provider per picker. Group only Cursor presets, retaining the current session's exact ID. */
export function providerModelChoices(
  catalogs: Partial<Record<AgentProviderId, ProviderModelList>>,
  settings: AppSettings,
  provider: AgentProviderId,
  currentModel: string | null,
  query: string,
): ModelChoice[] {
  const groups = new Map<string, ModelRow[]>();
  const catalogNames = (catalogs[provider]?.models ?? []).map((model) => model.displayName);
  const displayNameFor = (row: ModelRow) => modelDisplayName(provider, row.model.displayName, catalogNames);
  for (const row of visibleModels({ [provider]: catalogs[provider] }, settings, "")) {
    const key = provider === "cursor" ? displayNameFor(row) : row.model.id;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const needle = query.trim().toLowerCase();
  const choices: ModelChoice[] = [];
  for (const variants of groups.values()) {
    const displayName = displayNameFor(variants[0]);
    if (needle && !`${displayName} ${variants.map(({ model }) => `${model.id} ${model.displayName}`).join(" ")}`.toLowerCase().includes(needle)) continue;
    variants.sort((a, b) => {
      if ((a.model.id === currentModel) !== (b.model.id === currentModel)) return a.model.id === currentModel ? -1 : 1;
      if (Boolean(a.model.parameterized) !== Boolean(b.model.parameterized)) return a.model.parameterized ? -1 : 1;
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      // Prefer the offered entry with the least presentation metadata (e.g. plain over Thinking).
      const metadataLength = (row: ModelRow) => row.model.displayName.length - displayNameFor(row).length;
      return metadataLength(a) - metadataLength(b) || a.model.id.localeCompare(b.model.id);
    });
    const favoriteModelIds = variants.filter((row) => row.favorite).map((row) => row.model.id);
    choices.push({ ...variants[0], displayName, favorite: favoriteModelIds.length > 0, favoriteModelIds, variantIds: variants.map((row) => row.model.id) });
  }
  return choices.sort(compareModelGenerations);
}
