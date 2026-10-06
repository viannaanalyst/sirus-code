export const examples = [
 { id:"draft",title:"Detalhes da aparência e dos popups",project:"sirus",branch:"sirus/appearance",model:"GPT-6.1-Sol",icon:"openai",mono:true,rank:6 },
 { id:"sidebar",title:"Nova sidebar e navegação compacta",project:"sirus",branch:"sirus/sidebar",model:"GPT-6-Luna",icon:"openai",mono:true,rank:5,pr:1436,prState:"open" },
 { id:"browser",title:"Revisar o navegador integrado",project:"sirus",branch:"sirus/browser",model:"DeepSeek V4.1 Flash",icon:"deepseek",mono:false,rank:4,running:true },
 { id:"typography",title:"Fontes do sistema, código e terminal",project:"sirus",branch:"sirus/typography",model:"Kimi K3",icon:"kimi",mono:true,rank:3,pr:1437,prState:"merged" },
 { id:"fisio",title:"Ajustar os detalhes da interface",project:"fisioae",branch:"main",model:"Claude Sonnet 5",icon:"claude",mono:false,rank:2 },
 { id:"hello",title:"Conversa inicial do projeto",project:"sirus",branch:"main",model:"GPT-6.1-Sol",icon:"openai",mono:true,rank:1 },
];
export const freshState = () => ({ active:"sidebar",scope:"all",query:"",ascending:false,sessions:examples.map(row=>({...row})),drafts:{draft:"Confira também o contraste dos popups no modo claro."} });
export const hasDraft = (state,id) => Boolean(state.drafts[id]?.trim());
export function groups(state) {
 const needle=state.query.trim().toLocaleLowerCase();
 const rows=state.sessions.filter(row => (state.scope === "all" || state.scope === "drafts" ? state.scope !== "drafts" || hasDraft(state,row.id) : row.project === state.scope) && `${row.title} ${row.project} ${row.branch}`.toLocaleLowerCase().includes(needle)).toSorted((a,b)=>(state.ascending?1:-1)*(a.rank-b.rank));
 return [{name:"Rascunhos",rows:rows.filter(row=>hasDraft(state,row.id))},{name:"Recentes",rows:rows.filter(row=>!hasDraft(state,row.id))}].filter(group=>group.rows.length);
}
export function updateDraft(state,value) { if(value.trim()) state.drafts[state.active]=value; else delete state.drafts[state.active]; }
export function select(state,id) { if(!state.sessions.some(row=>row.id===id)) throw new Error("Unknown preview session");state.active=id;return state.drafts[id]??""; }
export function newSession(state) {
 const id=`new-${state.sessions.length}`;
 state.sessions.push({id,title:"Nova sessão",project:"sirus",branch:"main",model:"GPT-6.1-Sol",icon:"openai",mono:true,rank:Math.max(...state.sessions.map(row=>row.rank))+1});
 state.active=id;state.scope="all";state.query="";return id;
}
