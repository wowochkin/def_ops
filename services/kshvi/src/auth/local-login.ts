export type LocalLoginConfiguration=Readonly<{userId:string;roleId:string;origins:readonly string[]}>;
export const isLoopback=(address:string|undefined)=>address==='127.0.0.1'||address==='::1'||address==='::ffff:127.0.0.1';
/** Явная одномашинная конфигурация, привязанная к loopback, а не к клиентским полям. */
export function localLoginConfig(env:Record<string,string|undefined>):LocalLoginConfiguration|null{
 if(env.KSHVI_LOCAL_AUTOLOGIN!=='1'||env.KSHVI_SINGLE_MACHINE!=='1'||!isLoopback(env.HOST)||!env.KSHVI_LOCAL_USER_ID||!env.KSHVI_LOCAL_ROLE_ID)return null;
 const defaults=['http://127.0.0.1:8080','http://localhost:8080',...(env.NODE_ENV==='production'?[]:['http://127.0.0.1:5173','http://localhost:5173'])];
 const origins=(env.KSHVI_LOCAL_ORIGINS?.split(',')??defaults).map(value=>value.trim());
 if(!origins.length||origins.some(origin=>{try{const url=new URL(origin);return url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.origin!==origin;}catch{return true;}}))throw Error('Локальный вход допускает только явно заданные loopback-окна приложения');
 return {userId:env.KSHVI_LOCAL_USER_ID,roleId:env.KSHVI_LOCAL_ROLE_ID,origins};
}
