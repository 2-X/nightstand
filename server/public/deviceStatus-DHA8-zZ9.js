import{h as s,l as t}from"./index.js";const a=async e=>t.get("/deviceStatus",{signal:e}),n=()=>s({queryKey:["useDeviceStatus"],queryFn:async({signal:e})=>(await a(e)).data,refetchInterval:6e4}),c=e=>t.post("/deviceStatus",e);export{c as p,n as u};
//# sourceMappingURL=deviceStatus-DHA8-zZ9.js.map
