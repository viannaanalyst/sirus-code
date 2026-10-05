import { useState, type ReactNode } from 'react';
import { Check } from '@/components/icons/phosphor';
import { Button } from '../button/button';
import { ActionButton } from '../action-button/action-button';
import { SplitButton } from '../split-button/split-button';
import { DropdownMenu } from '../dropdown-menu/dropdown-menu';
import { ContextMenu } from '../context-menu/context-menu';
import { CopyButton } from '../copy-button/copy-button';
import { Drawer, DrawerTrigger, DrawerContent, DrawerClose } from '../drawer/drawer';
import { ThemeSwitch } from '../theme-switch/theme-switch';
import { Avatar } from '../avatar/avatar';
import { AvatarGroup } from '../avatar-group/avatar-group';
import { Input } from '../input/input';
import { Textarea } from '../textarea/textarea';
import { Select } from '../select/select';
import { Combobox } from '../combobox/combobox';
import { Checkbox } from '../checkbox/checkbox';
import { Switch } from '../switch/switch';
import { MultiSelect } from '../multi-select/multi-select';
import { NumberField } from '../number-field/number-field';
import { PasswordField } from '../password-field/password-field';
import { SearchField } from '../search-field/search-field';
import { TagInput } from '../tag-input/tag-input';
import { FileDropzone } from '../file-dropzone/file-dropzone';
import { RadioGroup } from '../radio-group/radio-group';
import SegmentedControl from '../segmented-control/segmented-control';
import { Calendar } from '../calendar/calendar';
import { DatePicker } from '../date-picker/date-picker';
import { TimePicker } from '../time-picker/time-picker';
import { Accordion } from '../accordion/accordion';
import { Dialog, DialogTrigger, DialogContent, DialogClose } from '../dialog/dialog';
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from '../popover/popover';
import { Tooltip } from '../tooltip/tooltip';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../tabs/tabs';
import { ExpandableCard } from '../expandable-card/expandable-card';
import { Breadcrumb } from '../breadcrumb/breadcrumb';
import { Alert } from '../alert/alert';
import Toast from '../toast/toast';
import { Progress } from '../progress/progress';
import { Skeleton } from '../skeleton/skeleton';
import { Badge } from '../badge/badge';
import { Card } from '../card/card';
import { MetricCard } from '../metric-card/metric-card';
import { EmptyState } from '../empty-state/empty-state';
import { TreeView } from '../tree-view/tree-view';
import { Pagination } from '../pagination/pagination';
import { FilterToolbar } from '../filter-toolbar/filter-toolbar';
import { SortableDataTable } from '../sortable-data-table/sortable-data-table';
import { Sparkline } from '../sparkline/sparkline';
import { Gauge } from '../gauge/gauge';
import { AnimatedCounter } from '../animated-counter/animated-counter';
import { CodeBlock } from '../code-block/code-block';
import { TextReveal } from '../text-reveal/text-reveal';
import { InViewTitle } from '../in-view-title/in-view-title';
import { TextMorph } from '../text-morph/text-morph';
import { TextShimmer } from '../text-shimmer/text-shimmer';
import { HoldToConfirm } from '../hold-to-confirm/hold-to-confirm';
import { SwipeActions, SwipeActionsRow } from '../swipe-actions/swipe-actions';
import { Slider } from '../slider/slider';
import { InlineEdit } from '../inline-edit/inline-edit';
import { ExpandingSearch } from '../expanding-search/expanding-search';
import { ChipGroup } from '../chip-group/chip-group';
import { PasswordStrength } from '../password-strength/password-strength';
import { BottomSheet } from '../bottom-sheet/bottom-sheet';
import { HoverCard, HoverCardProfile } from '../hover-card/hover-card';
import { ResizablePanels, ResizablePanel } from '../resizable-panels/resizable-panels';
import { ToastStackProvider, ToastStack, useToastStack } from '../toast-stack/toast-stack';
import { UsageMeter } from '../usage-meter/usage-meter';
import { ImageCompare } from '../image-compare/image-compare';
import { Carousel } from '../carousel/carousel';
import { BarChart } from '../bar-chart/bar-chart';
import { ActivityHeatmap } from '../activity-heatmap/activity-heatmap';
import { Timeline } from '../timeline/timeline';
import { UserMenu } from '../user-menu/user-menu';
import { Stepper } from '../stepper/stepper';
import { SignaturePad } from '../signature-pad/signature-pad';
import { DateRangePicker } from '../date-range-picker/date-range-picker';
import { ColorPicker } from '../color-picker/color-picker';
import { LineChart } from '../line-chart/line-chart';
import { DonutChart } from '../donut-chart/donut-chart';
import { Streamgraph } from '../streamgraph/streamgraph';
import { BrushChart } from '../brush-chart/brush-chart';
import { Ridgeline } from '../ridgeline/ridgeline';
import { Treemap } from '../treemap/treemap';
import { WaffleChart } from '../waffle-chart/waffle-chart';
import { SlopeChart } from '../slope-chart/slope-chart';
import { AnnouncementBar } from '../announcement-bar/announcement-bar';
import { JsonViewer } from '../json-viewer/json-viewer';
import { PhoneInput } from '../phone-input/phone-input';
import { ShortcutRecorder } from '../shortcut-recorder/shortcut-recorder';
import { ConfirmMorph } from '../confirm-morph/confirm-morph';
import { MentionInput } from '../mention-input/mention-input';
import { ChatThread } from '../chat-thread/chat-thread';
import { RichTextEditor } from '../rich-text-editor/rich-text-editor';
import { BillingToggle } from '../billing-toggle/billing-toggle';
import { ScrollArea } from '../scroll-area/scroll-area';
import { RadioCards } from '../radio-cards/radio-cards';
import { CommentThread } from '../comment-thread/comment-thread';
import { SlotText } from '../slot-text/slot-text';
const options = [{ value: 'first', label: 'First example' }, { value: 'second', label: 'Second example' }];
const data = [{ key: 'a', label: 'Example A', value: 30 }, { key: 'b', label: 'Example B', value: 50 }, { key: 'c', label: 'Example C', value: 20 }];
const series = [{ key: 'a', label: 'Example A' }, { key: 'b', label: 'Example B' }];
const timeData = [10, 20, 15, 30, 25].map((value, index) => ({ key: String(index), label: `Day ${index + 1}`, values: { a: value, b: 35 - value } }));
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="gray"/><circle cx="300" cy="200" r="90" fill="silver"/></svg>');
const picture = <img src={image} alt="Neutral geometric example" className="h-full w-full object-cover" />;
const person = { id: 'demo', name: 'Demo person' };
function ToastDemo() {
 const toast = useToastStack();
 return <div className="relative min-h-64"><Button onClick={() => toast.toast({ title: 'Local example notification' })}>Show example</Button><ToastStack contained hotkey={false} /></div>;
}
interface DemoState { text: string; setText: (value: string) => void; value: number; setValue: (value: number) => void; choice: string; setChoice: (value: string) => void; tags: string[]; setTags: (value: string[]) => void; done: boolean; setDone: (value: boolean) => void; }
export type ArcDemoName = 'button' | 'action-button' | 'split-button' | 'dropdown-menu' | 'context-menu' | 'copy-button' | 'drawer' | 'theme-switch' | 'theme-switch-eclipse' | 'theme-switch-split' | 'theme-switch-rise' | 'avatar' | 'avatar-group' | 'input' | 'textarea' | 'select' | 'combobox' | 'checkbox' | 'switch' | 'multi-select' | 'number-field' | 'password-field' | 'search-field' | 'tag-input' | 'file-dropzone' | 'radio-group' | 'segmented-control' | 'calendar' | 'date-picker' | 'time-picker' | 'accordion' | 'dialog' | 'popover' | 'tooltip' | 'tabs' | 'expandable-card' | 'breadcrumb' | 'alert' | 'toast' | 'progress' | 'skeleton' | 'badge' | 'card' | 'metric-card' | 'empty-state' | 'tree-view' | 'pagination' | 'filter-toolbar' | 'sortable-data-table' | 'sparkline' | 'gauge' | 'animated-counter' | 'code-block' | 'text-reveal' | 'in-view-title' | 'text-morph' | 'text-shimmer' | 'hold-to-confirm' | 'swipe-actions' | 'slider' | 'inline-edit' | 'expanding-search' | 'chip-group' | 'password-strength' | 'bottom-sheet' | 'hover-card' | 'resizable-panels' | 'toast-stack' | 'usage-meter' | 'image-compare' | 'carousel' | 'bar-chart' | 'activity-heatmap' | 'timeline' | 'user-menu' | 'stepper' | 'signature-pad' | 'date-range-picker' | 'color-picker' | 'line-chart' | 'donut-chart' | 'streamgraph' | 'brush-chart' | 'ridgeline' | 'treemap' | 'waffle-chart' | 'slope-chart' | 'announcement-bar' | 'json-viewer' | 'phone-input' | 'shortcut-recorder' | 'confirm-morph' | 'mention-input' | 'chat-thread' | 'rich-text-editor' | 'billing-toggle' | 'scroll-area' | 'radio-cards' | 'comment-thread' | 'slot-text';
export const previews = {
  'button': (s: DemoState) => <Button onClick={() => s.setValue(s.value + 1)}>Example clicks: {s.value}</Button>,
  'action-button': (s: DemoState) => <ActionButton label="Change local example" successLabel="Example changed" onAction={() => s.setValue(s.value + 1)} />,
  'split-button': (s: DemoState) => <SplitButton label="Example action" onClick={() => s.setText("Primary example selected")} actions={[{ label: "Alternative example", onSelect: () => s.setText("Alternative selected") }]} />,
  'dropdown-menu': (s: DemoState) => <DropdownMenu label="Example menu" items={[{ label: "Select example", onSelect: () => s.setText("Example selected") }, { label: "Disabled example", disabled: true }]} />,
  'context-menu': (s: DemoState) => <ContextMenu portal={false} label="Example context menu" items={[{ id: "one", label: "Select example", onSelect: () => s.setText("Example selected") }]}><Button>Open example context menu</Button></ContextMenu>,
  'copy-button': () => <CopyButton value="UI Arc local example" label="Copy example text" />,
  'drawer': () => <Drawer><DrawerTrigger asChild><Button>Open example drawer</Button></DrawerTrigger><DrawerContent title="Example drawer" description="Local component demonstration"><p>Example content</p><DrawerClose asChild><Button>Close</Button></DrawerClose></DrawerContent></Drawer>,
  'avatar': () => <Avatar name="Demo person" />,
  'avatar-group': () => <AvatarGroup members={[{ name: "Demo One" }, { name: "Demo Two" }, { name: "Demo Three" }]} max={2} />,
  'input': () => <Input label="Example input" placeholder="Type locally" />,
  'textarea': () => <Textarea label="Example notes" placeholder="Local text only" />,
  'select': () => <Select label="Example selection" options={options} />,
  'combobox': () => <Combobox label="Example searchable selection" options={options} />,
  'checkbox': () => <Checkbox label="Example checkbox" />,
  'switch': () => <Switch label="Example switch" />,
  'multi-select': () => <MultiSelect label="Example multiple selection" options={options} />,
  'number-field': () => <NumberField label="Example quantity" min={0} max={100} defaultValue={25} />,
  'password-field': () => <PasswordField label="Example password (do not enter real credentials)" autoComplete="off" />,
  'search-field': (s: DemoState) => <SearchField label="Example search" value={s.text} onValueChange={s.setText} />,
  'tag-input': () => <TagInput label="Example tags" defaultValue={["demo"]} />,
  'file-dropzone': (s: DemoState) => <FileDropzone label="Select local example files" description="Files stay local; no upload" note="No upload occurs" maxFiles={3} onFilesChange={files => s.setText(`${files.length} local files selected`)} />,
  'radio-group': (s: DemoState) => <RadioGroup label="Example radio options" options={options} value={s.choice} onValueChange={s.setChoice} />,
  'segmented-control': (s: DemoState) => <SegmentedControl label="Example segments" options={options} value={s.choice} onValueChange={s.setChoice} />,
  'calendar': () => <Calendar month={new Date(2026, 9, 1)} />,
  'date-picker': () => <DatePicker label="Example date" />,
  'time-picker': () => <TimePicker label="Example time" defaultValue="09:30" />,
  'accordion': () => <Accordion items={[{ title: "Example section", content: "Example content" }, { title: "Another section", content: "More local content" }]} />,
  'dialog': () => <Dialog><DialogTrigger asChild><Button>Open example dialog</Button></DialogTrigger><DialogContent title="Example dialog" description="Local component demonstration"><p>Example content</p><DialogClose asChild><Button>Close</Button></DialogClose></DialogContent></Dialog>,
  'popover': () => <Popover><PopoverTrigger asChild><Button>Open example popover</Button></PopoverTrigger><PopoverContent><p>Example popover content</p><PopoverClose asChild><Button>Close</Button></PopoverClose></PopoverContent></Popover>,
  'tooltip': () => <Tooltip content="Example tooltip"><Button>Focus or hover</Button></Tooltip>,
  'tabs': () => <Tabs defaultValue="first"><TabsList aria-label="Example tabs"><TabsTrigger value="first">First</TabsTrigger><TabsTrigger value="second">Second</TabsTrigger></TabsList><TabsContent value="first">First example content</TabsContent><TabsContent value="second">Second example content</TabsContent></Tabs>,
  'expandable-card': () => <ExpandableCard title="Example expandable card" description="Open to inspect"><p>Local example details</p></ExpandableCard>,
  'breadcrumb': (s: DemoState) => <Breadcrumb items={[{ label: "Examples", onClick: () => s.setText("Example parent selected") }, { label: "Current example" }]} />,
  'alert': () => <Alert title="Example notice">This is demonstration data.</Alert>,
  'toast': (s: DemoState) => <><Button onClick={() => s.setDone(true)}>Show example toast</Button><Toast title="Example notification" description="Local demonstration" open={s.done} onOpenChange={s.setDone} /></>,
  'progress': (s: DemoState) => <><Slider label="Local example progress" value={s.value} onValueChange={s.setValue} /><Progress label="Example progress" value={s.value} showValue /></>,
  'skeleton': () => <Skeleton label="Static example skeleton" lines={3} />,
  'badge': () => <Badge>Example badge</Badge>,
  'card': () => <Card title="Example card" description="Local demonstration" details={<p>Example details</p>} />,
  'metric-card': () => <MetricCard label="Example metric" value={42} context="Static demonstration data" />,
  'empty-state': () => <EmptyState title="Example empty state" description="No example items in this preview" />,
  'tree-view': () => <TreeView aria-label="Example tree" nodes={[{ id: "root", label: "Example folder", children: [{ id: "child", label: "Example file" }] }]} />,
  'pagination': (s: DemoState) => <Pagination page={s.value % 5 + 1} pageCount={5} onPageChange={page => s.setValue(page - 1)} />,
  'filter-toolbar': (s: DemoState) => <FilterToolbar label="Example filters" filters={s.done ? [] : [{ id: "demo", label: "Example", value: "Local" }]} onRemove={() => s.setDone(true)} />,
  'sortable-data-table': () => <SortableDataTable rows={data} columns={[{ key: "label", label: "Example", sortable: true }, { key: "value", label: "Example value", sortable: true }]} rowKey="key" caption="Static example rows" />,
  'sparkline': () => <Sparkline data={[10, 30, 20, 50]} label="Static example sparkline" />,
  'gauge': () => <Gauge value={35} label="Static example gauge" />,
  'animated-counter': (s: DemoState) => <><AnimatedCounter value={s.value} label="Local example counter" /><Button onClick={() => s.setValue(s.value + 10)}>Increase example</Button></>,
  'code-block': () => <CodeBlock code={"const example = true;"} filename="example.ts" language="typescript" />,
  'text-reveal': () => <TextReveal text="Example revealed text" as="p" />,
  'in-view-title': () => <InViewTitle text="Example in-view title" as="h3" />,
  'text-morph': (s: DemoState) => <><TextMorph>{s.text}</TextMorph><Button onClick={() => s.setText(s.text === "Example text" ? "Changed example" : "Example text")}>Change example</Button></>,
  'text-shimmer': () => <TextShimmer>Example shimmer text</TextShimmer>,
  'hold-to-confirm': (s: DemoState) => <HoldToConfirm label="Hold to change local example" confirmedLabel="Local example changed" onConfirm={() => s.setDone(true)} confirmed={s.done} />,
  'swipe-actions': (s: DemoState) => <SwipeActions label="Example swipe list"><SwipeActionsRow label="Example row" trailing={[{ label: "Example action", icon: <Check size={16} />, keepRow: true, onSelect: () => s.setText("Local example action") }]}><p className="p-4">Swipe example row</p></SwipeActionsRow></SwipeActions>,
  'slider': (s: DemoState) => <Slider label="Local example value" value={s.value} onValueChange={s.setValue} />,
  'inline-edit': (s: DemoState) => <InlineEdit label="Edit local example" value={s.text} onSave={s.setText} />,
  'expanding-search': (s: DemoState) => <ExpandingSearch label="Example expanding search" items={[{ id: "demo", title: "Example result" }]} onSelect={() => s.setText("Example result selected")} />,
  'chip-group': (s: DemoState) => <ChipGroup label="Example chips" options={options} value={s.tags} onValueChange={s.setTags} />,
  'password-strength': () => <PasswordStrength label="Example password strength (use sample text only)" autoComplete="off" />,
  'bottom-sheet': () => <BottomSheet title="Example bottom sheet" description="Local demonstration" trigger={<Button>Open example sheet</Button>}><p className="p-4">Example content</p></BottomSheet>,
  'hover-card': () => <HoverCard content={<HoverCardProfile name="Demo person" role="Example profile" bio="Demonstration data" />}><Button>Focus or hover example profile</Button></HoverCard>,
  'resizable-panels': () => <ResizablePanels label="Example resizable panels"><ResizablePanel id="left" label="First example panel" defaultSize={50}><p className="p-4">First example</p></ResizablePanel><ResizablePanel id="right" label="Second example panel" defaultSize={50}><p className="p-4">Second example</p></ResizablePanel></ResizablePanels>,
  'toast-stack': () => <ToastStackProvider limit={3}><ToastDemo /></ToastStackProvider>,
  'usage-meter': () => <UsageMeter label="Static example usage" segments={[{ id: "demo", label: "Example", value: 30 }]} limit={100} />,
  'image-compare': () => <ImageCompare before={picture} after={<div className="h-full w-full bg-background-2 p-12">After example</div>} label="Local geometric comparison" />,
  'carousel': () => <Carousel label="Example carousel" autoplay={false}><div className="p-12">Example slide one</div><div className="p-12">Example slide two</div></Carousel>,
  'bar-chart': () => <BarChart label="Static example bars" period="Example period" data={data} />,
  'activity-heatmap': () => <ActivityHeatmap label="Static example activity" period="October 2026" days={Array.from({ length: 21 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, count: i % 5 }))} />,
  'timeline': () => <Timeline label="Static example timeline" now={1790812800000} events={[{ id: "demo", at: "2026-10-01T09:00:00Z", title: "Example event", detail: "Example details" }]} />,
  'user-menu': (s: DemoState) => <UserMenu portal={false} user={{ name: "Demo person", email: "demo@example.invalid", plan: "Example profile" }} showTheme={false} items={[{ label: "Local example action", onSelect: () => s.setText("Example menu action") }]} />,
  'stepper': (s: DemoState) => <Stepper label="Example steps" steps={[{ id: "one", label: "First example" }, { id: "two", label: "Second example" }]} current={s.value % 2} onStepSelect={s.setValue} />,
  'signature-pad': () => <SignaturePad label="Example drawing pad" signer="Demo person" hint="Draw a local example; do not use a real signature" />,
  'date-range-picker': () => <DateRangePicker label="Example date range" />,
  'color-picker': () => <ColorPicker label="Example color" />,
  'line-chart': () => <LineChart label="Static example lines" data={timeData} series={series} />,
  'donut-chart': () => <DonutChart label="Static example donut" data={data} />,
  'streamgraph': () => <Streamgraph label="Static example streamgraph" data={timeData} series={series} />,
  'brush-chart': () => <BrushChart label="Static example brush chart" data={[10, 20, 15, 30, 25].map((value, i) => ({ date: new Date(2026, 9, i + 1), value }))} />,
  'ridgeline': () => <Ridgeline label="Static example distributions" series={[{ id: "a", label: "Example A", values: [1, 2, 2, 3, 4, 5] }, { id: "b", label: "Example B", values: [3, 4, 4, 5, 6, 7] }]} />,
  'treemap': () => <Treemap label="Static example treemap" data={{ id: "root", label: "Examples", children: data.map(row => ({ id: row.key, label: row.label, value: row.value })) }} />,
  'waffle-chart': () => <WaffleChart label="Static example proportions" data={data} />,
  'slope-chart': () => <SlopeChart label="Static example comparison" startLabel="Example before" endLabel="Example after" data={[{ key: "a", label: "Example A", start: 20, end: 30 }, { key: "b", label: "Example B", start: 40, end: 25 }]} />,
  'announcement-bar': () => <AnnouncementBar label="Example announcement" autoPlay={false} messages={[{ id: "demo", message: "Example announcement: local demonstration" }]} />,
  'json-viewer': () => <JsonViewer label="Example JSON" data={{ example: true, items: ["Demo A", "Demo B"] }} />,
  'phone-input': () => <PhoneInput label="Example phone number" description="Use sample digits only" />,
  'shortcut-recorder': () => <ShortcutRecorder label="Local example shortcut" description="Does not change application shortcuts" />,
  'confirm-morph': (s: DemoState) => <ConfirmMorph label="Change local example" prompt="Change this preview only?" doneLabel="Example changed locally" onConfirm={() => s.setDone(true)} />,
  'mention-input': () => <MentionInput aria-label="Example mentions" people={[person]} placeholder="Type @ to mention demo person" />,
  'chat-thread': () => <ChatThread label="Demo chat messages" participants={[person]} currentUserId="demo" messages={[{ id: "sample", authorId: "demo", text: "Demo message — static example, no agent connection", createdAt: "2026-10-01T09:00:00Z" }]} composer={false} />,
  'rich-text-editor': () => <RichTextEditor aria-label="Example local editor" defaultMarkdown="## Example notes
Local demonstration text." />,
  'billing-toggle': (s: DemoState) => <BillingToggle label="Example billing periods (no payments)" value={s.choice} onValueChange={s.setChoice} options={options} />,
  'scroll-area': () => <ScrollArea label="Example scroll region" maxHeight={180}>{Array.from({ length: 12 }, (_, i) => <p className="p-3" key={i}>Example row {i + 1}</p>)}</ScrollArea>,
  'radio-cards': () => <RadioCards aria-label="Example option cards" options={options} />,
  'comment-thread': () => <CommentThread title="Demo discussion" currentUser={person} defaultComments={[{ id: "demo", author: person, body: "Demo comment — local example only", createdAt: "Example date" }]} />,
  'slot-text': (s: DemoState) => <><SlotText value={s.value} /><Button onClick={() => s.setValue(s.value + 5)}>Change local example</Button></>,
  'theme-switch': (s: DemoState) => <ThemeSwitch theme={s.done ? "dark" : "light"} variant="reveal" onThemeChange={theme => s.setDone(theme === "dark")} label="Local example theme" />,
  'theme-switch-eclipse': (s: DemoState) => <ThemeSwitch theme={s.done ? "dark" : "light"} variant="eclipse" onThemeChange={theme => s.setDone(theme === "dark")} label="Local example theme" />,
  'theme-switch-split': (s: DemoState) => <ThemeSwitch theme={s.done ? "dark" : "light"} variant="split" onThemeChange={theme => s.setDone(theme === "dark")} label="Local example theme" />,
  'theme-switch-rise': (s: DemoState) => <ThemeSwitch theme={s.done ? "dark" : "light"} variant="rise" onThemeChange={theme => s.setDone(theme === "dark")} label="Local example theme" />,
} satisfies Record<ArcDemoName, (state: DemoState) => ReactNode>;
export function ArcPreview({ name }: { name: ArcDemoName }) {
 const [text, setText] = useState('Example text');
 const [value, setValue] = useState(25);
 const [choice, setChoice] = useState('first');
 const [tags, setTags] = useState<string[]>(['first']);
 const [done, setDone] = useState(false);
 return <div className="space-y-5">{previews[name]({ text, setText, value, setValue, choice, setChoice, tags, setTags, done, setDone })}<p className="text-xs text-text-muted" role="status">{text !== 'Example text' ? text : ''}</p></div>;
}
