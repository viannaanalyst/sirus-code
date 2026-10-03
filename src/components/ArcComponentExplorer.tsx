import { useId, useMemo, useState } from 'react';
import { InteractiveButton } from '@/primitives/InteractiveButton';
import { SidebarItem } from '@/primitives/SidebarItem';
import catalog from './arc/catalog.json';
import { ArcPreview, previews, type ArcDemoName } from './arc/demo/previews';

const categories = [...new Set(catalog.components.map(entry => entry.category))];
const copy = {
  en: { title: 'UI Arc components', introduction: '100 free MIT components. Preview data is illustrative; interactions stay local.', search: 'Search components', category: 'Category', all: 'All categories', close: 'Close explorer', preview: 'Interactive example', empty: 'No matching components', provenance: 'Vendored UI Arc MIT source · retrieved 2026-10-01', source: 'Source', docs: 'Upstream documentation', count: 'components' },
  'pt-BR': { title: 'Componentes UI Arc', introduction: '100 componentes gratuitos MIT. Dados ilustrativos; as interações são locais.', search: 'Buscar componentes', category: 'Categoria', all: 'Todas as categorias', close: 'Fechar explorador', preview: 'Exemplo interativo', empty: 'Nenhum componente encontrado', provenance: 'Código UI Arc MIT incluído · obtido em 01/10/2026', source: 'Código', docs: 'Documentação original', count: 'componentes' },
};

function isDemoName(name: string): name is ArcDemoName {
  return Object.hasOwn(previews, name);
}

export default function ArcComponentExplorer({ onClose, locale = 'en' }: { onClose?: () => void; locale?: 'en' | 'pt-BR' }) {
  const t = copy[locale];
  const id = useId();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<ArcDemoName>('button');
  const entries = useMemo(() => catalog.components.filter(entry => (!category || entry.category === category) && `${entry.title} ${entry.name} ${entry.category}`.toLowerCase().includes(search.trim().toLowerCase())), [search, category]);
  const entry = catalog.components.find(component => component.name === selected)!;
  const sourceName = selected.startsWith('theme-switch') ? 'theme-switch' : selected;
  return <section className="flex min-h-0 flex-1 flex-col bg-background-0 text-text-primary" aria-labelledby={`${id}-title`}>
    <header className="flex items-start justify-between gap-4 border-b border-border-subtle px-6 py-5">
      <div><h2 id={`${id}-title`} className="ui-dialog-title">{t.title}</h2><p className="mt-1 max-w-xl ui-caption text-text-secondary">{t.introduction}</p></div>
      {onClose && <InteractiveButton variant="ghost" onClick={onClose}>{t.close}</InteractiveButton>}
    </header>
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(180px,240px)_minmax(0,1fr)] max-sm:grid-cols-1">
      <nav className="flex min-h-0 flex-col gap-3 border-r border-border-subtle p-4 max-sm:max-h-64" aria-label={t.title}>
        <label className="space-y-1 ui-caption text-text-secondary" htmlFor={`${id}-search`}><span>{t.search}</span><input id={`${id}-search`} type="search" value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded-lg border border-border-subtle bg-background-1 px-3 py-2 text-text-primary" /></label>
        <label className="space-y-1 ui-caption text-text-secondary" htmlFor={`${id}-category`}><span>{t.category}</span><select id={`${id}-category`} value={category} onChange={event => setCategory(event.target.value)} className="w-full rounded-lg border border-border-subtle bg-background-1 px-3 py-2 text-text-primary"><option value="">{t.all}</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
        <p className="ui-caption text-text-muted" aria-live="polite">{entries.length} {t.count}</p>
        <div className="min-h-0 overflow-y-auto space-y-1">{entries.map(component => <SidebarItem key={component.name} active={selected === component.name} aria-current={selected === component.name ? 'true' : undefined} onClick={() => { if (isDemoName(component.name)) setSelected(component.name); }}>{component.title}</SidebarItem>)}{!entries.length && <p className="p-2 ui-body text-text-secondary">{t.empty}</p>}</div>
      </nav>
      <article className="min-w-0 overflow-y-auto p-6" aria-labelledby={`${id}-selected`}>
        <p className="ui-caption text-text-secondary">{entry.category} / {t.preview}</p><h3 id={`${id}-selected`} className="mt-2 ui-title">{entry.title}</h3>
        <div className="mt-6 min-h-48 rounded-xl border border-border-subtle bg-background-1 p-6"><ArcPreview key={selected} name={selected} /></div>
        <footer className="mt-6 space-y-2 break-all ui-caption text-text-muted"><p>{t.provenance}</p><p>{t.source}: src/components/arc/{sourceName}/{sourceName}.tsx</p><p>{t.docs}: {entry.docs}</p></footer>
      </article>
    </div>
  </section>;
}
