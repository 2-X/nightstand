import{h as r,l as n}from"./index.js";const u=(e=1e4)=>r({queryKey:["usePresence"],queryFn:async({signal:s})=>(await n.get("/metrics/presence",{signal:s})).data,refetchInterval:e});export{u};
//# sourceMappingURL=presence-D7xfHkHg.js.map
