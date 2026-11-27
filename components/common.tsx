"use client";
import React,{useState} from "react";
import {ArrowUpRight,Search,Inbox,ChevronRight,ChevronLeft,ListFilter,X} from "lucide-react";
import {Dialog} from "@base-ui/react/dialog";
import {Badge} from "./ui/badge";
import {Card} from "./ui/card";
import {Button} from "./ui/button";
import {useReactTable,getCoreRowModel,getSortedRowModel,getPaginationRowModel,flexRender,type ColumnDef,type SortingState} from "@tanstack/react-table";
import type {R} from "./context";
import {niceDate} from "@/lib/shared";
export {Button,Card};
export function Tag({children,tone="muted"}:{children:React.ReactNode;tone?:string}){return <Badge className={"tag "+tone}>{children}</Badge>}
export function Panel({title,kicker,action,children,className=""}:{title:string;kicker?:string;action?:React.ReactNode;children:React.ReactNode;className?:string}){return <Card className={"panel "+className}><header className="panel-head"><div>{kicker&&<div className="eyebrow">{kicker}</div>}<h2>{title}</h2></div>{action}</header>{children}</Card>}
export function Empty({text="No records at this snapshot."}:{text?:string}){return <div className="empty"><Inbox size={22}/><span>{text}</span></div>}
export function Sheet({title,children,close,wide=false,side=false,className=""}:{title:string;children:React.ReactNode;close:()=>void;wide?:boolean;side?:boolean;className?:string}){return <Dialog.Root open onOpenChange={v=>{if(!v)close()}}><Dialog.Portal><Dialog.Backdrop className="backdrop"/><Dialog.Popup className={(side?"sheet":"modal")+(wide?" wide":"")+(className?" "+className:"")} aria-describedby={undefined}><header className="modal-head"><Dialog.Title>{title}</Dialog.Title><button aria-label="Close dialog" className="iconbtn" onClick={close}><X size={19}/></button></header>{children}</Dialog.Popup></Dialog.Portal></Dialog.Root>}
export type Col={key:string;label:string;render?:(r:R)=>React.ReactNode};
export function Table({rows,columns,onRow,search="Search records",size=12}:{rows:R[];columns:Col[];onRow?:(r:R)=>void;search?:string|false;size?:number}){
 const [q,setQ]=useState(""),[sorting,setSorting]=useState<SortingState>([]);
 const filtered=React.useMemo(()=>rows.filter(r=>!q||columns.some(c=>String(r[c.key]??"").toLowerCase().includes(q.toLowerCase()))),[rows,q,columns]);
 const defs=React.useMemo<ColumnDef<R>[]>(()=>columns.map(c=>({id:c.key,accessorFn:r=>r[c.key],header:c.label,cell:d=>c.render?c.render(d.row.original):String(d.getValue()??"—")})),[columns]);
 const table=useReactTable({data:filtered,columns:defs,state:{sorting},onSortingChange:setSorting,getCoreRowModel:getCoreRowModel(),getSortedRowModel:getSortedRowModel(),getPaginationRowModel:getPaginationRowModel(),initialState:{pagination:{pageSize:size}},autoResetPageIndex:false});
 React.useEffect(()=>{table.setPageIndex(0)},[q,rows.length,size,table]);
 return <>{search!==false&&<label className="table-search"><Search size={16}/><input placeholder={search} aria-label={search} value={q} onChange={e=>setQ(e.target.value)}/></label>}{filtered.length?<><div className="table-scroll"><table><thead><tr>{table.getHeaderGroups()[0].headers.map(h=><th key={h.id} aria-sort={h.column.getIsSorted()==="asc"?"ascending":h.column.getIsSorted()==="desc"?"descending":undefined}><button onClick={h.column.getToggleSortingHandler()}>{flexRender(h.column.columnDef.header,h.getContext())}{h.column.getIsSorted()==="asc"?" ↑":h.column.getIsSorted()==="desc"?" ↓":""}</button></th>)}{onRow&&<th aria-label="Open record"/>}</tr></thead><tbody>{table.getRowModel().rows.map(row=><tr key={row.id} className={onRow?"clickable":""} onClick={onRow?()=>onRow(row.original):undefined}>{row.getVisibleCells().map(cell=><td key={cell.id}>{flexRender(cell.column.columnDef.cell,cell.getContext())}</td>)}{onRow&&<td><button className="iconbtn" aria-label={"Open "+(row.original.name||row.original.brand||row.original.title||"record")} onClick={e=>{e.stopPropagation();onRow(row.original)}}><ArrowUpRight size={15}/></button></td>}</tr>)}</tbody></table></div>{filtered.length>size&&<div className="pagination"><span>{table.getState().pagination.pageIndex*size+1}–{Math.min((table.getState().pagination.pageIndex+1)*size,filtered.length)} of {filtered.length}</span><button aria-label="Previous page" disabled={!table.getCanPreviousPage()} onClick={()=>table.previousPage()}><ChevronLeft size={16}/></button><button aria-label="Next page" disabled={!table.getCanNextPage()} onClick={()=>table.nextPage()}><ChevronRight size={16}/></button></div>}</>:<Empty text={q?"No matching records.":"No records at this snapshot."}/>}</>
}
export function Tabs({items,value,onChange}:{items:string[];value:string;onChange:(s:string)=>void}){return <div className="tabs">{items.map(t=><button className={value===t?"selected":""} key={t} onClick={()=>onChange(t)}>{t}</button>)}</div>}
export function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="field"><span>{label}</span>{children}</label>}
export function FilterButton({onClick,count}:{onClick:()=>void;count:number}){return <Button variant="outline" className="btn" onClick={onClick}><ListFilter size={16}/>Filters{count>0&&<b className="count">{count}</b>}</Button>}
export const dateCol=(key:string,label:string):Col=>({key,label,render:r=>niceDate(r[key]||"",true)});
