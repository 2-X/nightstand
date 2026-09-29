import{z as r,J as s}from"./index.js";const a=()=>r({queryKey:["useServices"],queryFn:async({signal:e})=>(await s.get("/services",{signal:e})).data}),o=e=>s.post("/services",e);export{o as p,a as u};
//# sourceMappingURL=services-DK50jhBB.js.map
