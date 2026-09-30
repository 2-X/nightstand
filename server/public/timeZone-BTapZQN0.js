function r(e){try{const t=new Intl.DateTimeFormat("en",{timeZone:e,timeZoneName:"longGeneric"}).formatToParts(new Date).find(a=>a.type==="timeZoneName")?.value,n=e.split("/").pop()?.replace(/_/g," ");return t&&n?`${t} (${n})`:e}catch{return e}}export{r as f};
//# sourceMappingURL=timeZone-BTapZQN0.js.map
