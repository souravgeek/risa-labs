"use client";
import React,{createContext,useContext} from "react";
export type R=Record<string,any>;
export type ModalSpec={kind:string;title?:string;row?:R;rows?:R[];extra?:R};
export type Desk={data:R;season:string;asOf:string;owner:string;filters:Record<string,string>;page:string;tab:string;busy:boolean;go:(page:string,tab?:string)=>void;open:(m:ModalSpec|null)=>void;act:(a:R)=>Promise<boolean>;refresh:()=>Promise<void>;copilot:()=>void;setDate:(v:string)=>void;setSeason:(v:string)=>void;setOwner:(v:string)=>void;setFilters:(v:Record<string,string>)=>void};
export const Context=createContext<Desk|null>(null);
export function useDesk(){const d=useContext(Context);if(!d)throw Error("Workspace unavailable.");return d}
