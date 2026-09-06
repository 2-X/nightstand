import{u,b as s}from"./index.js";const a=()=>u({queryKey:["useSchedules"],queryFn:async({signal:e})=>(await s.get("/schedules",{signal:e})).data}),n=e=>s.post("/schedules",e);export{n as p,a as u};
//# sourceMappingURL=schedules-B6d2N71h.js.map
