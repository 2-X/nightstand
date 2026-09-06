import{u,b as n}from"./index.js";const c=({side:a,startTime:e,endTime:s},r=!0)=>u({queryKey:["useSleepStages",a,e,s],queryFn:async({signal:t})=>(await n.get("/metrics/sleep-stages",{params:{side:a,startTime:e,endTime:s},signal:t})).data,enabled:r&&!!e&&!!s});export{c as u};
//# sourceMappingURL=sleepStages-Blk7AuaC.js.map
