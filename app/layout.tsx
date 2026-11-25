import type { Metadata } from "next";
import "@fontsource-variable/dm-sans";
import "./globals.css";
export const metadata:Metadata={title:"Unmaad · Sponsorship Growth Center",description:"Track festival sponsorship cash, partnerships, and the work that moves them forward."};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
