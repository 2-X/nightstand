import{L as s,M as t}from"./index.js";const a=async()=>t.get("/deviceStatus"),u=()=>s({queryKey:["useDeviceStatus"],queryFn:async()=>(await a()).data,refetchInterval:6e4}),n=e=>t.post("/deviceStatus",e);export{n as p,u};
//# sourceMappingURL=deviceStatus-uyh5UyTb.js.map
