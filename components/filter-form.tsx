"use client";
// Linked filters: each list only offers values that still have records under the other choices.
import React,{useMemo,useState} from "react";
import type {R} from "./context";
import {facetCount,filterRecords,filterDims as dims,type Dim} from "@/lib/filter-facets";

export function FilterForm({opts,initial,apply}:{opts:R;initial:Record<string,string>;apply:(f:Record<string,string>)=>void}){
  const [filters,setFilters]=useState<Record<string,string>>(initial);
  const recs=useMemo(()=>filterRecords(opts),[opts]);
  const lists:Record<Dim,[string,string][]>={
    campaign:(opts.campaigns||[]).map((c:R)=>[c.id,c.name]),
    channel:[["warm","Warm"],["cold","Cold"]],
    owner:(opts.owners||[]).map((o:R)=>[o.id,o.name]),
    industry:(opts.industries||[]).map((v:string)=>[v,v]),
  };
  const total=facetCount(recs,filters),any=dims.some(([d])=>filters[d]);
  return <form onSubmit={e=>{e.preventDefault();apply(filters)}}>
    {dims.map(([key,label])=>{
      const items=lists[key].map(([id,name])=>({id,name,n:facetCount(recs,filters,key,id)})).filter(o=>o.n>0||o.id===filters[key]);
      // A value kept from an earlier choice that no longer matches stays visible, so it doesn't vanish silently.
      return <label key={key}>{label}<select value={filters[key]||""} onChange={e=>setFilters({...filters,[key]:e.target.value})}>
        <option value="">{({campaign:"All campaigns",channel:"All channel groups",owner:"All owners",industry:"All industries"} as Record<Dim,string>)[key]}</option>
        {items.map(o=><option key={o.id} value={o.id}>{o.name}{o.n>0?" · "+o.n+(o.n===1?" brand":" brands"):" · no matches"}</option>)}
      </select></label>;
    })}
    {any&&<p className={"hint"+(total?"":" call-error")} role="status">{total?"Matches "+total+(total===1?" brand":" brands")+" and their deals.":"No brands match all of these filters. Change or clear one of them."}</p>}
    <div className="form-actions"><button type="button" className="btn" onClick={()=>setFilters({})}>Reset</button><button className="btn primary" disabled={any&&!total}>Apply filters</button></div>
  </form>;
}
