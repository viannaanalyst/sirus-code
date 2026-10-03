// Virtual DOM smoke checks for the standalone prototype, with no browser,
// provider, native bridge, permission prompt, external network or audio.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createContext, runInContext } from "node:vm";
const elements = new Map();
class Element {
  constructor(id = "") { this.id = id; this.dataset = {}; this.attributes = {}; this.value = ""; this.disabled = false; this.scrollHeight = 900; this._html = ""; }
  set innerHTML(value) {
    this._html = value;
    for (const match of value.matchAll(/<(?:button|textarea|div)[^>]*\bid="([^"]+)"[^>]*>/g)) {
      const node = new Element(match[1]); node.disabled = /\bdisabled\b/.test(match[0]); elements.set(node.id,node);
    }
  }
  get innerHTML() { return this._html; }
  setAttribute(key,value) { this.attributes[key] = value; }
  hasAttribute(key) { return Object.hasOwn(this.attributes,key); }
  closest(selector) { return selector === "button" ? this : null; }
  focus() {}
}
for (const id of ["feedback","activity","request","response","composer-tray","composer-caption","titlebar-actions","header-actions","tooltip-comparison","direction-description","favorite","stop-button","chat-scroll"]) elements.set(id,new Element(id));
const choices = Object.fromEntries([['theme',['dark','light','glass']],['variant',['line','trail','panel']],['tooltip',['micro','shortcut','context']],['scenario',['running','question','permission','completed','failed']]].map(([category,values])=>[category,values.map(value=>{const node = new Element(); node.dataset[category === 'scenario' ? category : `${category}Choice`] = value; return node;})]));
const handlers = new Map();
let milliseconds = 0;
const intervals = [];
const document = {
  documentElement:{dataset:{}}, hidden:false,
  body:{classList:{toggle(){}}},
  getElementById:id=>elements.get(id) ?? null,
  addEventListener:(event,fn)=>handlers.set(event,fn),
  querySelector:()=>null,
  querySelectorAll:selector=>{
    if (selector === '[data-scenario]') return choices.scenario;
    if (selector === '[data-elapsed]') return [new Element()];
    const category = selector.match(/\[data-(\w+)-choice\]/)?.[1];
    return choices[category] ?? [];
  },
};
const context = createContext({document, performance:{now:()=>milliseconds}, setTimeout:()=>0, clearTimeout(){}, setInterval:fn=>intervals.push(fn), IntersectionObserver:class{observe(){}}, localStorage:{getItem:()=>null,setItem(){}}, console});
runInContext(await readFile(new URL('./preview.js',import.meta.url),'utf8'),context);
const evaluate = code => runInContext(code,context);
const click = (id,dataset={},attributes={}) => { const button = elements.get(id) ?? new Element(id); button.dataset = dataset; button.attributes = attributes; handlers.get('click')({target:button}); };
const submit = () => handlers.get('submit')({target:{id:'question-form'},preventDefault(){}});
const choose = value => handlers.get('change')({target:{name:'tool-choice',value}});
const type = (id,value) => handlers.get('input')({target:{id,value}});
assert.equal(evaluate('elapsedSeconds()'),134);
milliseconds = 5000;
assert.equal(evaluate('elapsedSeconds()'),139);
for(const theme of ['dark','light','glass']) for(const variant of ['line','trail','panel']) {
  click('',{themeChoice:theme}); click('',{variantChoice:variant});
  assert.equal(document.documentElement.dataset.theme,theme);
  assert.equal(document.documentElement.dataset.variant,variant);
  for(const scenario of ['running','question','permission','completed','failed']) {
    click('',{scenario});
    assert.equal(evaluate('state.scenario'),scenario);
    assert.match(elements.get('activity').innerHTML,/GPT-6.1-Sol/);
    if(scenario === 'question') {
      assert.match(elements.get('request').innerHTML,/nenhuma|Nenhuma/);
      assert.equal(elements.get('question-submit').disabled,true);
      submit(); assert.equal(evaluate('state.questionStep'),0);
      choose('other'); assert.equal(elements.get('question-submit').disabled,true);
      type('question-custom','Agrupar por arquivo.'); assert.equal(elements.get('question-submit').disabled,false);
      const pausedAt = evaluate('elapsedSeconds()'); milliseconds += 7000;
      assert.equal(evaluate('elapsedSeconds()'),pausedAt);
      submit(); assert.equal(evaluate('state.questionStep'),1);
      assert.equal(elements.get('question-submit').disabled,true);
      type('question-detail','Mostrar o modelo.');
      submit(); assert.equal(evaluate('state.scenario'),'running');
      milliseconds += 2000; assert.equal(evaluate('elapsedSeconds()'),pausedAt+2);
    }
    if(scenario === 'permission') { assert.match(elements.get('request').innerHTML,/Permitir uma vez/); click('',{permission:'accept'}); assert.equal(evaluate('state.scenario'),'running'); }
    if(scenario === 'completed') assert.match(elements.get('response').innerHTML,/pronta para revisão/);
    if(scenario === 'failed') assert.match(elements.get('activity').innerHTML,/1 comando falhou/);
  }
}
for(const tooltip of ['micro','shortcut','context']) {
  click('',{tooltipChoice:tooltip});
  assert.equal(document.documentElement.dataset.tooltip,tooltip);
  assert.equal(elements.get('titlebar-actions').innerHTML.includes('<kbd>'),tooltip !== 'micro');
  assert.equal(elements.get('titlebar-actions').innerHTML.includes('tip-context'),tooltip === 'context');
}
click('stop-button'); assert.equal(evaluate('state.scenario'),'stopped'); assert.equal(elements.get('stop-button').disabled,true);
click('restart'); assert.equal(evaluate('elapsedSeconds()'),0); assert.equal(evaluate('state.scenario'),'running');
click('favorite'); assert.equal(evaluate('state.favorite.variant'), 'panel');
assert.equal((elements.get('tooltip-comparison').innerHTML.match(/tooltip-theme/g)||[]).length,3);
assert.equal((elements.get('tooltip-comparison').innerHTML.match(/sample-bubble/g)||[]).length,9);
const html = await readFile(new URL('./index.html',import.meta.url),'utf8');
assert.match(html,/dados simulados/); assert.match(html,/form-action 'none'/);
console.log('Virtual DOM smoke passed: 3 layouts × 3 themes × 5 states; explicit questions, paused/resumed time, permission, stop/restart, 3 tooltip options and 9 theme samples.');
