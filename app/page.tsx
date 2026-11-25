import {Workbench} from "@/components/workbench";
import {input,read} from "@/lib/workspace";
export const dynamic="force-dynamic";
export default async function Home(){return <Workbench initial={await read(input({}))}/>}
