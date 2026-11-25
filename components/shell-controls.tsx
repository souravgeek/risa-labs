import {ListFilter} from "lucide-react";
export {Button} from "./ui/button";
export function FilterButton({n,onClick}:{n:number;onClick:()=>void}){return <button className="btn" onClick={onClick}><ListFilter size={16}/>Filters{n>0&&<b className="count">{n}</b>}</button>}
