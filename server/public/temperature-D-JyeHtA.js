import{h as u,l as o}from"./index.js";const y=({side:s,startTime:e,endTime:r},a=!0)=>u({queryKey:["useTemperatureHistory",s,e,r],queryFn:async({signal:t})=>(await o.get("/metrics/temperature",{params:{side:s,startTime:e,endTime:r},signal:t})).data,enabled:a&&!!e&&!!r,refetchInterval:6e4});export{y as u};
//# sourceMappingURL=temperature-D-JyeHtA.js.map
