import type {NextConfig} from "next";
// allowedDevOrigins: the dev server only trusts "localhost" by default, so opening the app at 127.0.0.1
// would block hot reload (the /_next/hmr WebSocket). Development only; production is unaffected.
const config:NextConfig={outputFileTracingRoot:process.cwd(),devIndicators:false,allowedDevOrigins:["127.0.0.1"]};
export default config;
